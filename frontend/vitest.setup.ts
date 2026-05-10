// Pull in the Temporal polyfill once so every test file can rely on the
// global `Temporal` namespace. Avoids re-importing in each test.
import "@js-temporal/polyfill";
