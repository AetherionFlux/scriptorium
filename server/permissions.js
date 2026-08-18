/**
 * server/permissions.js — the single source of truth for access control.
 *
 * The role ladder, highest first:
 *   admin (global) > owner/maintainer (per space) > editor > viewer > anonymous
 *
 * Every API endpoint funnels through `can()`. The frontend mirrors these
 * decisions only to hide UI; it never makes the decision.
 */

export const ROLES = ['viewer', 'editor', 'maintainer', 'admin'];

/** Actions the engine knows about. */
export const ACTIONS = [
  'space.view',
  'page.view',
  'page.create',
  'page.update',
  'page.delete',
  'page.restore',
  'space.create',
  'space.update',
  'space.delete',
  'members.manage',
  'user.manage'
];

/**
 * @param {object} ctx
 * @param {object|null} ctx.user   { id, role } of the current user, or null
 * @param {object} ctx.space       the space row the action targets
 * @param {string} ctx.action      one of ACTIONS
 * @param {object} [opts]
 * @param {number|null} [opts.pageAuthorId]  for page.delete: the page's creator
 * @returns {boolean}
 */
export function can(ctx, action, opts = {}) {
  const { user, space } = ctx;

  // Global admin: everything, always.
  if (user?.role === 'admin') return true;

  // Unauthenticated: read-only on public spaces, nothing else.
  if (!user) {
    return (action === 'space.view' || action === 'page.view') && space.visibility === 'public';
  }

  const role = spaceRole(user.id, space);
  if (role === null) {
    // No membership: anonymous-style rules still apply to authenticated users.
    return (action === 'space.view' || action === 'page.view') && space.visibility === 'public';
  }

  switch (action) {
    case 'space.view':
    case 'page.view':
      return true; // any membership grants at least read
    case 'page.create':
    case 'page.update':
      return ['editor', 'maintainer', 'owner'].includes(role);
    case 'page.delete':
      if (['maintainer', 'owner'].includes(role)) return true;
      // A plain editor (or even the page author) may delete their own page.
      return opts.pageAuthorId != null && opts.pageAuthorId === user.id;
    case 'page.restore':
      return ['maintainer', 'owner'].includes(role);
    case 'space.update':
    case 'space.delete':
    case 'members.manage':
      return ['maintainer', 'owner'].includes(role);
    case 'space.create':
      return true; // any authenticated user
    case 'user.manage':
      return false; // admin only (handled above)
    default:
      return false;
  }
}

/**
 * Effective role of a user in a space.
 * @param {number} userId
 * @param {object} space  space row; owner_id makes the owner a maintainer
 * @returns {'owner'|'maintainer'|'editor'|'viewer'|null}
 */
export function spaceRole(userId, space) {
  if (space.owner_id === userId) return 'owner';
  const member = space.__members?.find((m) => m.user_id === userId);
  return member?.role ?? null;
}

/** True when the user can see the space in listings. */
export function spaceVisibleTo(space, user) {
  if (space.visibility === 'public') return true;
  return !!user && spaceRole(user.id, space) !== null;
}