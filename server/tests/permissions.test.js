/**
 * server/tests/permissions.test.js — role ladder semantics.
 */
import { describe, it, expect } from 'vitest';
import { can, spaceRole, spaceVisibleTo } from '../permissions.js';

const space = (over = {}) => ({
  id: 1, slug: 's', name: 'S', visibility: 'public', owner_id: 9, __members: [], ...over
});
const user = (id, role = 'user') => ({ id, role });
const ctx = (u, s) => ({ user: u, space: s });

describe('can()', () => {
  it('lets anonymous read public spaces only', () => {
    expect(can(ctx(null, space()), 'page.view')).toBe(true);
    expect(can(ctx(null, space({ visibility: 'private' })), 'page.view')).toBe(false);
    expect(can(ctx(null, space()), 'page.create')).toBe(false);
  });

  it('lets authenticated users create spaces', () => {
    expect(can(ctx(user(1), space()), 'space.create')).toBe(true);
    expect(can(ctx(null, space()), 'space.create')).toBe(false);
  });

  it('owner is a maintainer', () => {
    expect(spaceRole(9, space())).toBe('owner');
    expect(can(ctx(user(9), space()), 'space.update')).toBe(true);
    expect(can(ctx(user(9), space()), 'members.manage')).toBe(true);
    expect(can(ctx(user(9), space({ visibility: 'private' })), 'page.view')).toBe(true);
  });

  it('members get their granted role', () => {
    const s = space({ __members: [{ user_id: 5, role: 'editor' }] });
    expect(spaceRole(5, s)).toBe('editor');
    expect(can(ctx(user(5), s), 'page.update')).toBe(true);
    expect(can(ctx(user(5), s), 'space.update')).toBe(false);
    expect(can(ctx(user(5), s), 'page.delete')).toBe(false); // not the author, not a maintainer
  });

  it('editors can delete only their own pages', () => {
    const s = space({ __members: [{ user_id: 5, role: 'editor' }] });
    expect(can(ctx(user(5), s), 'page.delete', { pageAuthorId: 5 })).toBe(true);
    expect(can(ctx(user(5), s), 'page.delete', { pageAuthorId: 7 })).toBe(false);
  });

  it('non-members cannot see private spaces, can see public ones', () => {
    expect(can(ctx(user(2), space({ visibility: 'private' })), 'page.view')).toBe(false);
    expect(can(ctx(user(2), space({ visibility: 'public' })), 'page.view')).toBe(true);
    expect(spaceVisibleTo(space({ visibility: 'private' }), user(2))).toBe(false);
    expect(spaceVisibleTo(space(), user(2))).toBe(true);
  });

  it('maintainer (member grant) manages the space but is not admin', () => {
    const s = space({ __members: [{ user_id: 3, role: 'maintainer' }] });
    expect(can(ctx(user(3), s), 'members.manage')).toBe(true);
    expect(can(ctx(user(3), s), 'user.manage')).toBe(false);
  });

  it('global admin bypasses everything', () => {
    expect(can(ctx(user(1, 'admin'), space({ visibility: 'private' })), 'page.update')).toBe(true);
    expect(can(ctx(user(1, 'admin'), space({ visibility: 'private' })), 'user.manage')).toBe(true);
    expect(can(ctx(user(1, 'admin'), space({ visibility: 'private' })), 'page.restore')).toBe(true);
  });

  it('rejects unknown actions', () => {
    expect(can(ctx(user(1, 'admin'), space()), 'fly.to.moon')).toBe(false);
    expect(can(ctx(user(1), space()), 'user.manage')).toBe(false);
  });
});