/* Game "API". In this static version every call is answered by js/server.js (rules + save data in
   localStorage). The call shape is unchanged so the rest of the game code did not need to change. */
(function () {
  'use strict';
  const NA = (window.NA = window.NA || {});
  NA.api = {
    csrf: '',
    async call(action, body) {
      return NA.server.handle(action, body === undefined ? {} : body);
    },
  };
})();
