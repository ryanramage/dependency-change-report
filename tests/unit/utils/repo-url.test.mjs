import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeRepoUrl, toDisplayUrl, normalizeVersion } from '../../../lib/utils/repo-url.mjs';

describe('normalizeRepoUrl', () => {
  it('drops monorepo web-path suffixes (the redux-saga breakage)', () => {
    assert.equal(
      normalizeRepoUrl('https://github.com/redux-saga/redux-saga/tree/main/packages/core'),
      'git@github.com:redux-saga/redux-saga.git'
    );
  });

  it('handles git+https with .git', () => {
    assert.equal(normalizeRepoUrl('git+https://github.com/foo/bar.git'), 'git@github.com:foo/bar.git');
  });

  it('handles git+ssh and ssh forms', () => {
    assert.equal(normalizeRepoUrl('git+ssh://git@github.com/foo/bar.git'), 'git@github.com:foo/bar.git');
    assert.equal(normalizeRepoUrl('ssh://git@github.com/foo/bar'), 'git@github.com:foo/bar.git');
  });

  it('handles git:// protocol', () => {
    assert.equal(normalizeRepoUrl('git://github.com/foo/bar'), 'git@github.com:foo/bar.git');
  });

  it('handles scp-style git@ URLs', () => {
    assert.equal(normalizeRepoUrl('git@github.com:foo/bar.git'), 'git@github.com:foo/bar.git');
  });

  it('handles shorthand and preserves the real host', () => {
    assert.equal(normalizeRepoUrl('github:foo/bar'), 'git@github.com:foo/bar.git');
    assert.equal(normalizeRepoUrl('gitlab:foo/bar'), 'git@gitlab.com:foo/bar.git');
    assert.equal(normalizeRepoUrl('bitbucket:foo/bar'), 'git@bitbucket.org:foo/bar.git');
  });

  it('strips #hash and ?query', () => {
    assert.equal(normalizeRepoUrl('https://github.com/foo/bar#readme'), 'git@github.com:foo/bar.git');
    assert.equal(normalizeRepoUrl('https://github.com/foo/bar.git?x=1'), 'git@github.com:foo/bar.git');
  });

  it('returns null for unparseable / insufficient input', () => {
    assert.equal(normalizeRepoUrl(''), null);
    assert.equal(normalizeRepoUrl(null), null);
    assert.equal(normalizeRepoUrl('not a url'), null);
    assert.equal(normalizeRepoUrl('https://github.com/onlyowner'), null);
  });
});

describe('toDisplayUrl', () => {
  it('converts to https for display', () => {
    assert.equal(toDisplayUrl('git@github.com:foo/bar.git'), 'https://github.com/foo/bar');
    assert.equal(toDisplayUrl('git+https://github.com/foo/bar.git'), 'https://github.com/foo/bar');
    assert.equal(toDisplayUrl('gitlab:foo/bar'), 'https://gitlab.com/foo/bar');
  });
});

describe('normalizeVersion', () => {
  it('strips range operators', () => {
    assert.equal(normalizeVersion('^1.3.0'), '1.3.0');
    assert.equal(normalizeVersion('~2.0.1'), '2.0.1');
    assert.equal(normalizeVersion('>= 4.5.0'), '4.5.0');
    assert.equal(normalizeVersion('v3.2.1'), 'v3.2.1');
  });

  it('returns null for missing/empty/undefined', () => {
    assert.equal(normalizeVersion(undefined), null);
    assert.equal(normalizeVersion(null), null);
    assert.equal(normalizeVersion(''), null);
    assert.equal(normalizeVersion('undefined'), null);
    assert.equal(normalizeVersion('*'), null);
  });
});
