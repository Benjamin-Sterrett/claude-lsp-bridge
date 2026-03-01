import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toExternalPosition,
  toLspPosition,
  toExternalRange,
  toLspRange,
  filePathToUri,
  uriToFilePath,
  charOffsetToUtf16,
  utf16ToCharOffset,
  toolSuccess,
  toolError,
} from '../src/types.ts';

describe('Position conversion', () => {
  it('converts 0-based LSP to 1-based external', () => {
    assert.deepStrictEqual(toExternalPosition({ line: 0, character: 0 }), { line: 1, character: 1 });
    assert.deepStrictEqual(toExternalPosition({ line: 41, character: 7 }), { line: 42, character: 8 });
  });

  it('converts 1-based external to 0-based LSP', () => {
    assert.deepStrictEqual(toLspPosition({ line: 1, character: 1 }), { line: 0, character: 0 });
    assert.deepStrictEqual(toLspPosition({ line: 42, character: 8 }), { line: 41, character: 7 });
  });

  it('throws on zero or negative external position', () => {
    assert.throws(() => toLspPosition({ line: 0, character: 1 }), /must be >= 1/);
    assert.throws(() => toLspPosition({ line: 1, character: 0 }), /must be >= 1/);
    assert.throws(() => toLspPosition({ line: -1, character: 1 }), /must be >= 1/);
  });

  it('round-trips position conversion', () => {
    const original = { line: 10, character: 5 };
    assert.deepStrictEqual(toExternalPosition(toLspPosition(toExternalPosition(original))), toExternalPosition(original));
  });
});

describe('Range conversion', () => {
  it('converts LSP range to external range', () => {
    const lspRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } };
    const expected = { start: { line: 1, character: 1 }, end: { line: 1, character: 11 } };
    assert.deepStrictEqual(toExternalRange(lspRange), expected);
  });

  it('converts external range to LSP range', () => {
    const extRange = { start: { line: 5, character: 3 }, end: { line: 10, character: 1 } };
    const expected = { start: { line: 4, character: 2 }, end: { line: 9, character: 0 } };
    assert.deepStrictEqual(toLspRange(extRange), expected);
  });
});

describe('URI normalization', () => {
  it('converts absolute path to file:// URI', () => {
    assert.equal(filePathToUri('/foo/bar.ts'), 'file:///foo/bar.ts');
    assert.equal(filePathToUri('/Users/ben/Projects/app/src/index.ts'), 'file:///Users/ben/Projects/app/src/index.ts');
  });

  it('converts file:// URI back to path', () => {
    assert.equal(uriToFilePath('file:///foo/bar.ts'), '/foo/bar.ts');
    assert.equal(uriToFilePath('file:///Users/ben/Projects/app/src/index.ts'), '/Users/ben/Projects/app/src/index.ts');
  });

  it('round-trips path → URI → path', () => {
    const path = '/Users/ben/Projects/my app/src/utils.ts';
    assert.equal(uriToFilePath(filePathToUri(path)), path);
  });

  it('percent-encodes special characters', () => {
    const path = '/Users/ben/my project/src/file name.ts';
    const uri = filePathToUri(path);
    assert.ok(uri.includes('my%20project'));
    assert.ok(uri.includes('file%20name.ts'));
    assert.equal(uriToFilePath(uri), path);
  });

  it('handles hash and question mark in filenames', () => {
    const path = '/Users/ben/src/test#1.ts';
    const uri = filePathToUri(path);
    assert.equal(uriToFilePath(uri), path);
  });

  it('throws on relative path', () => {
    assert.throws(() => filePathToUri('foo/bar.ts'), /absolute path/);
  });

  it('throws on non-file URI', () => {
    assert.throws(() => uriToFilePath('https://example.com'), /file:\/\/ URI/);
  });

  it('canonicalizes dot segments in paths', () => {
    assert.equal(filePathToUri('/foo/./bar/../baz.ts'), 'file:///foo/baz.ts');
  });

  it('handles file URI with localhost authority', () => {
    assert.equal(uriToFilePath('file://localhost/foo/bar.ts'), '/foo/bar.ts');
  });

  it('rejects file URI with remote host', () => {
    assert.throws(() => uriToFilePath('file://remote-host/foo/bar.ts'), /remote hosts/);
  });
});

describe('UTF-16 offset conversion', () => {
  it('handles ASCII text (no change)', () => {
    assert.equal(charOffsetToUtf16('hello world', 5), 5);
    assert.equal(utf16ToCharOffset('hello world', 5), 5);
  });

  it('handles emoji (astral plane / surrogate pair)', () => {
    // '😀' is U+1F600, takes 2 UTF-16 code units but 1 codepoint
    const text = 'a😀b';
    // charOffset 0='a', 1='😀', 2='b'
    // utf16: 0='a', 1-2='😀', 3='b'
    assert.equal(charOffsetToUtf16(text, 0), 0); // before 'a'
    assert.equal(charOffsetToUtf16(text, 1), 1); // after 'a', before emoji
    assert.equal(charOffsetToUtf16(text, 2), 3); // after emoji, before 'b'
  });

  it('converts UTF-16 offset back to char offset', () => {
    const text = 'a😀b';
    assert.equal(utf16ToCharOffset(text, 0), 0);
    assert.equal(utf16ToCharOffset(text, 1), 1);
    assert.equal(utf16ToCharOffset(text, 3), 2);
  });

  it('handles multiple surrogate pairs', () => {
    const text = '𝐀𝐁c'; // U+1D400, U+1D401, 'c'
    // char offsets: 0=𝐀, 1=𝐁, 2=c
    // utf16 offsets: 0-1=𝐀, 2-3=𝐁, 4=c
    assert.equal(charOffsetToUtf16(text, 2), 4);
    assert.equal(utf16ToCharOffset(text, 4), 2);
  });

  it('handles empty string', () => {
    assert.equal(charOffsetToUtf16('', 0), 0);
    assert.equal(utf16ToCharOffset('', 0), 0);
  });
});

describe('Tool result helpers', () => {
  it('creates success result', () => {
    const result = toolSuccess('Found definition');
    assert.deepStrictEqual(result, { content: [{ type: 'text', text: 'Found definition' }] });
    assert.equal('isError' in result, false);
  });

  it('creates error result', () => {
    const result = toolError('File not found');
    assert.deepStrictEqual(result, { content: [{ type: 'text', text: 'File not found' }], isError: true });
  });
});
