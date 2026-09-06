'use strict';

const fs = require('fs');
const path = require('path');

/**
 * PersistentFile — tiny atomic JSON persistence helper (tmp + rename).
 * No dependencies, synchronous (files are small).
 */
class PersistentFile {
  constructor(filePath, defaultValue) {
    this.filePath = filePath;
    this.defaultValue = defaultValue;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return this.defaultValue;
    }
  }

  save(data) {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.filePath);
    } catch (e) {
      console.error(`[persist] failed to save ${this.filePath}: ${e.message}`);
    }
  }
}

module.exports = { PersistentFile };