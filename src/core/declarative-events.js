/**
 * Declarative event controller used by migrated static markup and render templates.
 * It replaces executable inline HTML attributes without exposing handlers globally.
 * Supported statements are intentionally restricted to this application's legacy UI grammar.
 */
function parseArgument(token, element, event) {
  const value = token.trim();
  if (value === 'this') return element;
  if (value === 'event') return event;
  if (value === 'this.value') return element.value;
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return Number(value);
  const string = value.match(/^(['"])([\s\S]*)\1$/);
  if (string) return string[2];
  throw new Error(`Unsupported declarative argument: ${value}`);
}

function runStatement(statement, handlers, element, event) {
  const source = statement.trim();
  if (!source) return;
  if (source === 'event.stopPropagation()') { event.stopPropagation(); return; }
  const navigation = source.match(/^window\.location\.href\s*=\s*(['"])(.*?)\1$/);
  if (navigation) { window.location.href = navigation[2]; return; }
  const click = source.match(/^document\.getElementById\((['"])(.*?)\1\)\.click\(\)$/);
  if (click) { document.getElementById(click[2])?.click(); return; }
  const call = source.match(/^([A-Za-z_$][\w$]*)\((.*)\)$/);
  if (!call || typeof handlers[call[1]] !== 'function') throw new Error(`Unknown declarative action: ${source}`);
  const args = call[2].trim() ? call[2].split(',').map(token => parseArgument(token, element, event)) : [];
  handlers[call[1]](...args);
}

export function bindDeclarativeEvents(handlers, root = document) {
  const events = { click:'data-fibo-click', input:'data-fibo-input', change:'data-fibo-change' };
  Object.entries(events).forEach(([eventName,attribute]) => {
    root.addEventListener(eventName, event => {
      const element = event.target.closest?.(`[${attribute}]`);
      if (!element || !root.contains(element)) return;
      element.getAttribute(attribute).split(';').forEach(statement => runStatement(statement, handlers, element, event));
    });
  });
}

