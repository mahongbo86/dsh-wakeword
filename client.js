window.__ModuleLoader__.load({
  id: 'dsh-wakeword',
  factory(require) {
    const React = require('react');

    return {
      inject: [],
      apply(ctx) {
        // Placeholder: the composer-side microphone, keyword stream and the
        // wake -> dictate -> stop-word state machine land here next.
        void React;
        void ctx;
      },
    };
  },
});
