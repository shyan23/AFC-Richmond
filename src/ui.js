'use strict';

(function (root, factory) {
  const API = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.SSSUI = API;
})(typeof window !== 'undefined' ? window : null, function () {
  function attachUI(rootEl, simFactory) {
    const state = { mode: 'swarm', paused: false, heat: true, mult: 1, stepAcc: 0 };
    const ui = rootEl;
    ui.mode = state.mode;
    return { state, ui, simFactory };
  }

  return { attachUI };
});