const { JSDOM } = require("jsdom");
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf-8');
const script = fs.readFileSync('js/app.js', 'utf-8');

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: "usable"
});

// Polyfill missing features if needed
dom.window.console.log = console.log;
dom.window.console.error = console.error;
dom.window.console.warn = console.warn;

dom.window.onerror = function(msg, url, line, col, error) {
   console.error("Runtime Error:", msg, "Line:", line, "Col:", col);
   // We exit process once we grab the error
   process.exit(1);
};

// Evaluate the app.js code
try {
  // Strip import statements for the Node environment evaluation
  const safeScript = script.replace(/import .*/g, '');
  dom.window.eval(safeScript);
  console.log("Successfully evaluated script.");
  
  // Trigger DOMContentLoaded
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  setTimeout(() => {
    console.log("No runtime errors caught in 3 seconds.");
    process.exit(0);
  }, 3000);
} catch (e) {
  console.error("Evaluation Error:", e);
  process.exit(1);
}
