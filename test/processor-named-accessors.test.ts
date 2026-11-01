import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Synth } from '../src/core/synth.js';
import { withNamedAccessor } from './named-accessors-harness.js';
import { installWorkletHarness, startedEngine } from './worklet-harness.js';

const restore = await installWorkletHarness();
after(restore);

test('processor state keeps its own slots despite inherited setters', async () => {
  const opm = await startedEngine();
  try {
    // Test-only typing: the in-process harness node exposes the real processor it constructed.
    const node = opm.node as unknown as { processor: object };
    const Processor = node.processor.constructor as new (options: AudioWorkletNodeOptions) => object;
    const names = ['synth', 'events', 'notes', 'patches', 'errorCount', 'rejectedNotes', 'closed',
      'dispatchFrame', 'renderFrameBase', 'rendering'];
    for (const key of names) {
      const result = withNamedAccessor(key, () => new Processor({ processorOptions: { maxVoices: 3 } }));
      const processor = result.value as Record<string, unknown>;
      assert.equal(result.setterHits, 0, key);
      for (const name of names) assert.ok(Object.hasOwn(processor, name), `${key} → ${name}`);
      assert.ok(processor.synth instanceof Synth, key);
      assert.equal((processor.synth as Synth).maxVoices, 3, key);
      assert.equal(processor.errorCount, 0, key);
    }
  } finally { await opm.dispose(); }
});
