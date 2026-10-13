'use strict';
const express = require('express');

/** Router, dessen Handler auch async sein dürfen (Fehler landen in der Fehler-Middleware). */
function asyncRouter() {
  const r = express.Router();
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    const orig = r[m].bind(r);
    r[m] = (route, ...handlers) =>
      orig(
        route,
        ...handlers.map((h) => (req, res, next) => {
          try {
            const out = h(req, res, next);
            if (out && typeof out.then === 'function') out.catch(next);
          } catch (e) {
            next(e);
          }
        })
      );
  }
  return r;
}

module.exports = { asyncRouter };
