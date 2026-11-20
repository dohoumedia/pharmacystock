import type { RefObject } from 'react';
import type { View } from 'react-native';
/** A dedicated document keeps navigation/forms out of browser print, without new dependencies. */
export function printReceipt(ref: RefObject<View | null>): boolean {
  const element = ref.current as unknown as HTMLElement | null;
  if (!element || typeof document === 'undefined') return false;
  const frame = document.createElement('iframe');
  frame.title = document.title;
  frame.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) { frame.remove(); return false; }
  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px system-ui;margin:20px;color:#111}div{display:block;white-space:normal}span{display:block}button,input{display:none}@page{margin:12mm}</style></head><body></body></html>');
  doc.close();
  doc.documentElement.lang = document.documentElement.lang;
  doc.body.appendChild(element.cloneNode(true));
  frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60000);
  return true;
}
