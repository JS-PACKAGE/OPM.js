import { MAX_RENDER_SAMPLES } from './sequence.js';

export interface ChorusOptions { rate: number; depth: number; mix: number; feedback?: number; voices?: number }
export interface ReverbOptions { size: number; damping: number; mix: number; preDelay?: number; width?: number }
export interface StereoEffectsOptions { chorus?: ChorusOptions; reverb?: ReverbOptions; order?: 'chorus-reverb' | 'reverb-chorus' }
export interface StereoEffects {
  process(left: Float32Array, right: Float32Array, offset?: number, length?: number): void;
  /** Replaces the complete configuration; omitted sections fade to bypass. */
  update(params: StereoEffectsOptions): void;
  reset(): void;
  readonly tailSeconds: number;
  readonly params: Readonly<StereoEffectsOptions>;
}

/** Internal trust-boundary helper, also used by the worklet protocol. */
export function effectsData(input: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) throw new TypeError(`${label} must be a plain data object`);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !keys.includes(key)) throw new TypeError(`${label} has an unknown field`);
    const field = Object.getOwnPropertyDescriptor(input, key)!;
    if (!Object.hasOwn(field, 'value')) throw new TypeError(`${label}.${key} must be data`);
    result[key] = field.value;
  }
  return result;
}
function bounded(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`${label} must be finite in ${min}..${max}`);
  return value;
}
export function normalizeEffectsOptions(input: StereoEffectsOptions = {}): Readonly<StereoEffectsOptions> {
  const data = effectsData(input, ['chorus', 'reverb', 'order'], 'effects');
  const result: StereoEffectsOptions = {};
  if (Object.hasOwn(data, 'chorus')) {
    const c = effectsData(data.chorus, ['rate', 'depth', 'mix', 'feedback', 'voices'], 'chorus');
    const voices = Object.hasOwn(c, 'voices') ? bounded(c.voices, 1, 4, 'voices') : 2;
    if (!Number.isInteger(voices)) throw new RangeError('voices must be an integer in 1..4');
    result.chorus = Object.freeze({ rate: bounded(c.rate, .05, 10, 'rate'), depth: bounded(c.depth, 0, 1, 'depth'), mix: bounded(c.mix, 0, 1, 'mix'), feedback: Object.hasOwn(c, 'feedback') ? bounded(c.feedback, 0, .7, 'feedback') : 0, voices });
  }
  if (Object.hasOwn(data, 'reverb')) {
    const r = effectsData(data.reverb, ['size', 'damping', 'mix', 'preDelay', 'width'], 'reverb');
    result.reverb = Object.freeze({ size: bounded(r.size, 0, 1, 'size'), damping: bounded(r.damping, 0, 1, 'damping'), mix: bounded(r.mix, 0, 1, 'mix'), preDelay: Object.hasOwn(r, 'preDelay') ? bounded(r.preDelay, 0, .1, 'preDelay') : 0, width: Object.hasOwn(r, 'width') ? bounded(r.width, 0, 1, 'width') : 1 });
  }
  result.order = Object.hasOwn(data, 'order') ? data.order as StereoEffectsOptions['order'] : 'chorus-reverb';
  if (result.order !== 'chorus-reverb' && result.order !== 'reverb-chorus') throw new TypeError('Invalid effects order');
  return Object.freeze(result);
}
const typed = Object.getPrototypeOf(Float32Array.prototype) as object;
const kind = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag)!.get!;
const size = Object.getOwnPropertyDescriptor(typed, 'length')!.get!;
function frames(left: Float32Array, right: Float32Array, offset: number, length?: number): number {
  if (kind.call(left) !== 'Float32Array' || kind.call(right) !== 'Float32Array') throw new RangeError('effects require native Float32Arrays');
  const count = length === undefined ? size.call(left) - offset : length;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(count) || count < 0 || offset + count > size.call(left) || offset + count > size.call(right)) throw new RangeError('Invalid effects buffer range');
  return count;
}
function clean(value: number): number { return !Number.isFinite(value) || Math.abs(value) < 1e-20 ? 0 : Math.max(-1e6, Math.min(1e6, value)); }
class Delay {
  readonly data: Float64Array;
  position = 0;
  constructor(length: number) { this.data = new Float64Array(length); }
  read(delay: number): number {
    let index = this.position - delay;
    if (index < 0) index += this.data.length;
    const base = Math.floor(index), fraction = index - base;
    return this.data[base]! * (1 - fraction) + this.data[(base + 1) % this.data.length]! * fraction;
  }
  push(value: number): void { this.data[this.position] = clean(value); if (++this.position === this.data.length) this.position = 0; }
  reset(): void { this.data.fill(0); this.position = 0; }
}
// Original seconds-based Schroeder network; not chip emulation or copied reverb code.
const COMBS = [.0297, .0371, .0411, .0437];
const DIFFUSERS = [.0053, .0017];
class Engine implements StereoEffects {
  private snapshot: Readonly<StereoEffectsOptions>;
  private readonly current = new Float64Array(22);
  private readonly target = new Float64Array(22);
  private readonly chorus: Delay[];
  private readonly pre: Delay[];
  private readonly combs: Delay[];
  private readonly diffusers: Delay[];
  private readonly low = new Float64Array(8);
  private phase = 0;
  private left = 0;
  private right = 0;
  private remaining = 0;
  private order: StereoEffectsOptions['order'];
  private orderGain = 1;
  private tailBound = 0;
  private readonly ramp: number;
  constructor(private readonly rate: number, options: StereoEffectsOptions) {
    this.snapshot = normalizeEffectsOptions(options);
    this.order = this.snapshot.order;
    this.ramp = Math.ceil(rate * .02);
    this.chorus = [new Delay(Math.ceil(rate * .02) + 2), new Delay(Math.ceil(rate * .02) + 2)];
    this.pre = [new Delay(Math.ceil(rate * .1) + 2), new Delay(Math.ceil(rate * .1) + 2)];
    this.combs = []; this.diffusers = [];
    for (let channel = 0; channel < 2; channel++) {
      for (const seconds of COMBS) this.combs.push(new Delay(Math.max(1, Math.round((seconds + channel * .0011) * rate))));
      for (const seconds of DIFFUSERS) this.diffusers.push(new Delay(Math.max(1, Math.round((seconds + channel * .0007) * rate))));
    }
    this.setTargets(); this.current.set(this.target);
  }
  get params(): Readonly<StereoEffectsOptions> { return this.snapshot; }
  get tailSeconds(): number { return this.tailBound; }
  private setTargets(): void {
    const c = this.snapshot.chorus, r = this.snapshot.reverb, t = this.target;
    t[0] = c?.rate ?? 1; t[1] = c?.depth ?? 0; t[2] = c?.mix ?? 0; t[3] = c?.feedback ?? 0;
    for (let i = 0; i < 4; i++) t[4 + i] = i < (c?.voices ?? 2) ? 1 : 0;
    t[8] = r?.size ?? 0; t[9] = r?.damping ?? 0; t[10] = r?.preDelay ?? 0; t[11] = r?.mix ?? 0; t[12] = r?.width ?? 1;
    for (let i = 0; i < 8; i++) t[14 + i] = Math.exp(-Math.log(1000) * this.combs[i]!.data.length / this.rate / (.2 + 3 * t[8]!));
    const tail = (c && c.mix > 0 ? .02 * (1 + Math.log(1e-6) / Math.log(Math.max(.001, c.feedback ?? 0))) : 0) + (r && r.mix > 0 ? .3 + 3 * (.2 + 3 * r.size) : 0);
    this.tailBound = Math.max(this.tailBound, tail);
  }
  update(params: StereoEffectsOptions): void { this.snapshot = normalizeEffectsOptions(params); this.setTargets(); this.remaining = this.ramp; }
  reset(): void {
    for (const group of [this.chorus, this.pre, this.combs, this.diffusers]) for (const delay of group) delay.reset();
    this.low.fill(0); this.phase = 0; this.current.set(this.target); this.remaining = 0; this.order = this.snapshot.order; this.orderGain = 1;
    this.tailBound = 0; this.setTargets();
  }
  private chorusFrame(): void {
    const p = this.current, a = this.left, b = this.right;
    let l = 0, r = 0, weights = 0;
    for (let voice = 0; voice < 4; voice++) {
      const weight = p[4 + voice]!; weights += weight;
      l += weight * this.chorus[0]!.read(this.rate * (.01 + .008 * p[1]! * Math.sin(this.phase + voice * Math.PI / 2)));
      r += weight * this.chorus[1]!.read(this.rate * (.01 + .008 * p[1]! * Math.sin(this.phase + voice * Math.PI / 2 + Math.PI / 2)));
    }
    l /= Math.max(1, weights); r /= Math.max(1, weights);
    this.chorus[0]!.push(a + p[3]! * l); this.chorus[1]!.push(b + p[3]! * r);
    this.phase += 2 * Math.PI * p[0]! / this.rate; if (this.phase >= 2 * Math.PI) this.phase -= 2 * Math.PI;
    const mix = p[2]!;
    if (mix !== 0) { this.left = a * (1 - mix) + .7 * (1 - p[3]!) * l * mix; this.right = b * (1 - mix) + .7 * (1 - p[3]!) * r * mix; }
  }
  private reverbFrame(): void {
    const p = this.current, a = this.left, b = this.right;
    let wetL = 0, wetR = 0;
    for (let channel = 0; channel < 2; channel++) {
      const source = channel === 0 ? a : b, pre = this.pre[channel]!;
      const delayed = p[10] === 0 ? source : pre.read(Math.max(1, p[10]! * this.rate)); pre.push(source);
      let sum = 0;
      for (let i = 0; i < 4; i++) {
        const index = channel * 4 + i, comb = this.combs[index]!;
        const out = comb.data[comb.position]!;
        const damping = p[9]! * .9;
        this.low[index] = clean(out * (1 - damping) + this.low[index]! * damping);
        const gain = p[14 + index]!;
        comb.push((1 - gain) * delayed + gain * this.low[index]!); sum += out * .25;
      }
      for (let i = 0; i < 2; i++) {
        const diffuser = this.diffusers[channel * 2 + i]!, old = diffuser.data[diffuser.position]!;
        const out = old - .5 * sum; diffuser.push(sum + .5 * out); sum = out / 3;
      }
      if (channel === 0) wetL = sum; else wetR = sum;
    }
    const mid = (wetL + wetR) * .5, width = p[12]!, mix = p[11]!;
    if (mix !== 0) { this.left = a * (1 - mix) + .7 * (mid + width * (wetL - mid)) * mix; this.right = b * (1 - mix) + .7 * (mid + width * (wetR - mid)) * mix; }
  }
  process(left: Float32Array, right: Float32Array, offset = 0, length?: number): void {
    const count = frames(left, right, offset, length);
    for (let frame = offset; frame < offset + count; frame++) {
      if (this.remaining > 0) { for (let i = 0; i < 22; i++) this.current[i] = this.remaining === 1 ? this.target[i]! : this.current[i]! + (this.target[i]! - this.current[i]!) / this.remaining; this.remaining--; }
      if (this.order !== this.snapshot.order) { this.orderGain = Math.max(0, this.orderGain - 1 / this.ramp); if (this.orderGain === 0) this.order = this.snapshot.order; }
      else this.orderGain = Math.min(1, this.orderGain + 1 / this.ramp);
      const a = left[frame]!, b = right[frame]!;
      this.left = clean(a); this.right = clean(b);
      if (this.order === 'chorus-reverb') { this.chorusFrame(); this.reverbFrame(); } else { this.reverbFrame(); this.chorusFrame(); }
      // Dry bypass does not even rewrite finite samples (including signed zero).
      if (this.current[2] !== 0 || this.current[11] !== 0) {
        left[frame] = clean(a) * (1 - this.orderGain) + clean(this.left) * this.orderGain;
        right[frame] = clean(b) * (1 - this.orderGain) + clean(this.right) * this.orderGain;
      } else { if (!Number.isFinite(a)) left[frame] = 0; if (!Number.isFinite(b)) right[frame] = 0; }
    }
  }
}
export function createStereoEffects(sampleRate: number, options: StereoEffectsOptions = {}): StereoEffects {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('sampleRate must be an integer in 8000..192000');
  return new Engine(sampleRate, options);
}
export function applyEffects(left: Float32Array, right: Float32Array, sampleRate: number, params: StereoEffectsOptions): { left: Float32Array; right: Float32Array } {
  const count = frames(left, right, 0);
  if (size.call(right) !== count) throw new RangeError('Effects stereo lengths must match');
  const effects = createStereoEffects(sampleRate, params), length = count + Math.ceil(effects.tailSeconds * sampleRate);
  if (!Number.isSafeInteger(length) || length > MAX_RENDER_SAMPLES) throw new RangeError('Effects render exceeds 4,000,000-frame budget');
  const l = new Float32Array(length), r = new Float32Array(length); l.set(left); r.set(right); effects.process(l, r);
  return { left: l, right: r };
}
