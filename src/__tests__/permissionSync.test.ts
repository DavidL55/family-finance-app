import { describe, expect, it, vi } from 'vitest';
import { recomputeMemberIds, unionMemberIds } from '../utils/permissionSync';

describe('unionMemberIds', () => {
  it('combines before and after with no duplicates', () => {
    expect(unionMemberIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('includes a member removed from the group (present only in before)', () => {
    const result = unionMemberIds(['a', 'b'], ['b']);
    expect(result).toContain('a'); // removed member still needs recompute
    expect(result).toContain('b');
    expect(result).toHaveLength(2);
  });

  it('includes a member newly added to the group (present only in after)', () => {
    const result = unionMemberIds(['a'], ['a', 'c']);
    expect(result).toContain('c');
    expect(result).toHaveLength(2);
  });

  it('an empty after array (group deleted) still returns every before member', () => {
    expect(unionMemberIds(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('an empty before array (new group) returns exactly the after members', () => {
    expect(unionMemberIds([], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('both empty returns empty', () => {
    expect(unionMemberIds([], [])).toEqual([]);
  });
});

describe('recomputeMemberIds', () => {
  it('calls the recompute function once per member id and reports all as succeeded', async () => {
    const recompute = vi.fn(async () => undefined);
    const result = await recomputeMemberIds(['a', 'b', 'c'], recompute);
    expect(recompute).toHaveBeenCalledTimes(3);
    expect(recompute).toHaveBeenNthCalledWith(1, 'a');
    expect(recompute).toHaveBeenNthCalledWith(2, 'b');
    expect(recompute).toHaveBeenNthCalledWith(3, 'c');
    expect(result).toEqual({ succeeded: ['a', 'b', 'c'], failed: [] });
  });

  it('continues past a single failing member instead of aborting the loop', async () => {
    const recompute = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('boom-b');
    });
    const result = await recomputeMemberIds(['a', 'b', 'c'], recompute);
    expect(recompute).toHaveBeenCalledTimes(3); // b failing did not stop c from being attempted
    expect(result.succeeded).toEqual(['a', 'c']);
    expect(result.failed).toEqual([{ memberId: 'b', error: 'boom-b' }]);
  });

  it('an empty id list calls recompute zero times and returns empty result', async () => {
    const recompute = vi.fn(async () => undefined);
    const result = await recomputeMemberIds([], recompute);
    expect(recompute).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: [], failed: [] });
  });
});
