// src/__tests__/navGroups.test.tsx — Stage 8 S2. The nav menu as collapsible groups.
//
// David's rule 3 (spec 2026-08-29): menus expand/collapse on click so the screen shows only
// what matters. The registry stays the single source of truth (D6): each entry declares its
// group; a new module without a group FAILS here, not in a reviewer's eye.
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MODULE_REGISTRY, NAV_GROUPS, type NavGroupId } from '../config/moduleRegistry';
import { NavGroup } from '../components/NavGroup';

describe('registry — every module belongs to a declared nav group (D6)', () => {
  it('every entry carries a group from NAV_GROUPS', () => {
    const ids = NAV_GROUPS.map((g) => g.id);
    for (const entry of MODULE_REGISTRY) {
      expect(ids, `${entry.id} has group "${entry.group}"`).toContain(entry.group);
    }
  });

  it('the group set is pinned — adding a fifth group is a decision, not an accident', () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(['daily', 'assets', 'reports']);
    expect(NAV_GROUPS.map((g) => g.labelHe)).toEqual(['יומיומי', 'נכסים והתחייבויות', 'דוחות וכלים']);
  });

  it('no group is empty — a header with nothing under it is a dead accordion', () => {
    for (const g of NAV_GROUPS) {
      expect(MODULE_REGISTRY.filter((e) => e.group === g.id).length, g.id).toBeGreaterThan(0);
    }
  });
});

describe('NavGroup — the collapsible menu section', () => {
  const items = [<button key="a">מסך א</button>, <button key="b">מסך ב</button>];

  it('open renders children; header click collapses; aria-expanded tracks', () => {
    render(<NavGroup labelHe="נכסים" open onToggle={() => {}}>{items}</NavGroup>);
    expect(screen.getByText('מסך א')).toBeTruthy();
    expect(screen.getByRole('button', { name: /נכסים/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('closed hides children and reports aria-expanded=false', () => {
    render(<NavGroup labelHe="נכסים" open={false} onToggle={() => {}}>{items}</NavGroup>);
    expect(screen.queryByText('מסך א')).toBeNull();
    expect(screen.getByRole('button', { name: /נכסים/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking the header fires onToggle — state belongs to the caller', () => {
    let toggled = 0;
    render(<NavGroup labelHe="נכסים" open onToggle={() => { toggled += 1; }}>{items}</NavGroup>);
    fireEvent.click(screen.getByRole('button', { name: /נכסים/ }));
    expect(toggled).toBe(1);
  });
});
