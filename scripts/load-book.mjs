// Loads a gamebook JSON for Node scripts/tests and attaches its riddle pool (book.riddlePool).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRiddlePool } from '../public/js/engine.js';

export const DEFAULT_BOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'neon-dragon.json');

export function loadBook(file = DEFAULT_BOOK) {
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (book.riddlePool) attachRiddlePool(book, JSON.parse(fs.readFileSync(path.join(path.dirname(file), book.riddlePool), 'utf8')));
  return book;
}
