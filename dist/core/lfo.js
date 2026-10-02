const e=2*Math.PI;function r(r,t){if(!Number.isFinite(r))throw new RangeError("LFO phase must be finite");if("sine"===t)return Math.sin(r);const n=r/e,a=n-Math.floor(n);switch(t){case"triangle":return a<.25?4*a:a<.75?2-4*a:4*a-4;case"saw":return 2*a-1;case"square":return a<.5?1:-1;default:throw new RangeError("Unsupported LFO waveform")}}export{r as lfoValue};
//# sourceMappingURL=lfo.js.map
