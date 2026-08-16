import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  listMembers: vi.fn(),
  listGroups: vi.fn(),
  saveGroup: vi.fn(async () => undefined),
  deleteGroup: vi.fn(async () => undefined),
  listPermissionDocs: vi.fn(),
  saveModulePermissions: vi.fn(async () => undefined),
  recomputeResolvedPermissions: vi.fn(async () => undefined),
}));

vi.mock('../services/MembersService', () => ({ listMembers: mocks.listMembers }));
vi.mock('../services/GroupsService', () => ({
  listGroups: mocks.listGroups,
  saveGroup: mocks.saveGroup,
  deleteGroup: mocks.deleteGroup,
}));
vi.mock('../services/PermissionsService', () => ({
  listPermissionDocs: mocks.listPermissionDocs,
  saveModulePermissions: mocks.saveModulePermissions,
  recomputeResolvedPermissions: mocks.recomputeResolvedPermissions,
}));

import PermissionsManager from '../components/PermissionsManager';

const OMER = { id: 'omer-levy', name: 'עומר', role: 'ילד', color: '#111', groups: [], createdAt: 'x', updatedAt: 'x' };
const LILIT = { id: 'lilit-levy', name: 'לילית', role: 'הורה', color: '#222', groups: [], createdAt: 'x', updatedAt: 'x' };

describe('PermissionsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // vi.clearAllMocks() only clears call history, not a persistent mockRejectedValue/
    // mockResolvedValue implementation set by an earlier test (mockReset would, but several
    // service mocks intentionally keep their vi.hoisted default shape) -- re-assert every
    // service's default success behavior here so no test can leak a rejection into the next one.
    mocks.listMembers.mockResolvedValue([OMER]);
    mocks.listGroups.mockResolvedValue([]);
    mocks.listPermissionDocs.mockResolvedValue([]);
    mocks.saveGroup.mockResolvedValue(undefined);
    mocks.deleteGroup.mockResolvedValue(undefined);
    mocks.saveModulePermissions.mockResolvedValue(undefined);
    mocks.recomputeResolvedPermissions.mockResolvedValue(undefined);
  });

  describe('super-admin gate', () => {
    it('does not render the management screen for a non-super-admin role', () => {
      render(<PermissionsManager actorMemberId="lilit-levy" role="parent" />);
      expect(screen.queryByText('ניהול משפחה והרשאות')).not.toBeInTheDocument();
      expect(mocks.listMembers).not.toHaveBeenCalled();
    });

    it('does not render for a plain member role either', () => {
      render(<PermissionsManager actorMemberId="omer-levy" role="member" />);
      expect(screen.queryByText('ניהול משפחה והרשאות')).not.toBeInTheDocument();
    });

    it('renders for super-admin', async () => {
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('ניהול משפחה והרשאות')).toBeInTheDocument());
    });
  });

  it('renders an error state (not empty) when loading members fails, with a retry affordance', async () => {
    mocks.listMembers.mockRejectedValueOnce(new Error('down'));
    render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText(/שגיאה/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /נסה שוב/ })).toBeInTheDocument();
  });

  it('retry after a failed load re-calls the services and recovers to ready', async () => {
    mocks.listMembers.mockRejectedValueOnce(new Error('down'));
    render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText(/שגיאה/)).toBeInTheDocument());

    mocks.listMembers.mockResolvedValueOnce([OMER]);
    fireEvent.click(screen.getByRole('button', { name: /נסה שוב/ }));
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
  });

  it('lists members once loaded', async () => {
    render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
  });

  it('surfaces the four Stage 3 modules once MODULE_IDS is extended — no per-module UI code needed (component is generic over MODULE_IDS)', async () => {
    render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));
    await waitFor(() => expect(screen.getByText('חשבונות ויתרות')).toBeInTheDocument());
    expect(screen.getByText('תנועות קבועות')).toBeInTheDocument();
    expect(screen.getByText('הלוואות וחובות')).toBeInTheDocument();
    expect(screen.getByText('ביטוחים')).toBeInTheDocument();
  });

  it('matrix loads and displays current grants for a member with an existing exception doc (D8)', async () => {
    mocks.listPermissionDocs.mockResolvedValue([
      {
        id: 'member__omer-levy',
        scope: 'member',
        targetId: 'omer-levy',
        modules: {
          expenses: { view: 'family', edit: 'none' },
          income: { view: 'family', edit: 'none' },
          investments: { view: 'family', edit: 'none' },
          goals: { view: 'family', edit: 'none' },
        },
        updatedAt: 'x',
        updatedBy: 'david-levy',
      },
    ]);
    render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));

    const expensesView = screen.getByTestId('permission-select-omer-levy-expenses-view') as HTMLSelectElement;
    expect(expensesView.value).toBe('family');
    const expensesEdit = screen.getByTestId('permission-select-omer-levy-expenses-edit') as HTMLSelectElement;
    expect(expensesEdit.value).toBe('none');
  });

  it('saving a member matrix entry calls saveModulePermissions then recomputeResolvedPermissions for that member', async () => {
    render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));
    fireEvent.click(screen.getByTestId('save-permissions-omer-levy'));

    await waitFor(() => expect(mocks.saveModulePermissions).toHaveBeenCalledWith('member', 'omer-levy', expect.any(Object), 'david-levy'));
    await waitFor(() => expect(mocks.recomputeResolvedPermissions).toHaveBeenCalledWith('omer-levy'));
  });

  it('ownerless modules (income/investments/goals) do not offer "own" as a choice, only expenses does', async () => {
    render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));

    const expensesView = screen.getByTestId('permission-select-omer-levy-expenses-view');
    expect(within(expensesView).queryByRole('option', { name: 'אישי' })).toBeInTheDocument();

    for (const moduleId of ['income', 'investments', 'goals']) {
      const viewSelect = screen.getByTestId(`permission-select-omer-levy-${moduleId}-view`);
      expect(within(viewSelect).queryByRole('option', { name: 'אישי' })).not.toBeInTheDocument();
      expect(within(viewSelect).queryByRole('option', { name: 'ללא' })).toBeInTheDocument();
      expect(within(viewSelect).queryByRole('option', { name: 'משפחתי' })).toBeInTheDocument();

      // 'own' is never offered for edit either, on an ownerless module — checked with view raised
      // to 'family' so the edit-cannot-exceed-view clamp (tested separately below) isn't itself
      // the reason 'family' would be missing here.
      fireEvent.change(viewSelect, { target: { value: 'family' } });
      const editSelect = screen.getByTestId(`permission-select-omer-levy-${moduleId}-edit`);
      expect(within(editSelect).queryByRole('option', { name: 'אישי' })).not.toBeInTheDocument();
      expect(within(editSelect).queryByRole('option', { name: 'ללא' })).toBeInTheDocument();
      expect(within(editSelect).queryByRole('option', { name: 'משפחתי' })).toBeInTheDocument();
    }
  });

  describe('guardrail (a): write succeeds, recompute fails -> distinct stale message, not a generic save-failure', () => {
    it('shows a distinct stale-permissions banner (not "השמירה נכשלה") when the write commits but recompute keeps failing, and offers a retry that can recover', async () => {
      mocks.recomputeResolvedPermissions.mockRejectedValue(new Error('recompute down'));
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());

      fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));
      fireEvent.click(screen.getByTestId('save-permissions-omer-levy'));

      // The write itself succeeded (saveModulePermissions resolved) -- must NOT show a generic
      // save-failed message.
      await waitFor(() => expect(mocks.saveModulePermissions).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByText('השמירה נכשלה')).not.toBeInTheDocument());

      // A distinct stale-permissions message must appear instead.
      await waitFor(() => expect(screen.getByTestId('stale-permissions-banner')).toBeInTheDocument());
      expect(screen.getByTestId('stale-permissions-banner').textContent).not.toMatch(/^השמירה נכשלה$/);

      // A one-click re-trigger is available and can recover.
      mocks.recomputeResolvedPermissions.mockResolvedValueOnce(undefined);
      fireEvent.click(screen.getByTestId('retry-stale-recompute'));
      await waitFor(() => expect(screen.queryByTestId('stale-permissions-banner')).not.toBeInTheDocument());
    });

    it('a save that succeeds and whose recompute also succeeds shows no stale banner at all', async () => {
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());

      fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));
      fireEvent.click(screen.getByTestId('save-permissions-omer-levy'));

      await waitFor(() => expect(mocks.recomputeResolvedPermissions).toHaveBeenCalledWith('omer-levy'));
      expect(screen.queryByTestId('stale-permissions-banner')).not.toBeInTheDocument();
    });

    it('an actual write failure (saveModulePermissions rejects) shows a save-failed error and never calls recompute', async () => {
      mocks.saveModulePermissions.mockRejectedValueOnce(new Error('write down'));
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());

      fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));
      fireEvent.click(screen.getByTestId('save-permissions-omer-levy'));

      await waitFor(() => expect(screen.getByText(/השמירה נכשלה/)).toBeInTheDocument());
      expect(mocks.recomputeResolvedPermissions).not.toHaveBeenCalled();
    });
  });

  describe('groups CRUD and guardrail (b): union-of-before/after-memberIds recompute', () => {
    beforeEach(() => {
      mocks.listMembers.mockResolvedValue([OMER, LILIT]);
      mocks.listGroups.mockResolvedValue([
        { id: 'kids', name: 'הילדים', memberIds: ['omer-levy'], createdAt: 'x', updatedAt: 'x' },
      ]);
    });

    it('creating a new group with members recomputes exactly the union([], newMemberIds)', async () => {
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('הילדים')).toBeInTheDocument());

      fireEvent.click(screen.getByTestId('create-group-button'));
      fireEvent.change(screen.getByTestId('new-group-id-input'), { target: { value: 'parents' } });
      fireEvent.change(screen.getByTestId('new-group-name-input'), { target: { value: 'ההורים' } });
      fireEvent.click(screen.getByTestId('new-group-member-lilit-levy'));
      fireEvent.click(screen.getByTestId('save-group-new'));

      await waitFor(() => expect(mocks.saveGroup).toHaveBeenCalledWith(
        { id: 'parents', name: 'ההורים', memberIds: ['lilit-levy'] },
        'david-levy',
        [] // new group -> previousMemberIds is empty, so GroupsService arrayUnions the new members
      ));
      await waitFor(() => expect(mocks.recomputeResolvedPermissions).toHaveBeenCalledWith('lilit-levy'));
      expect(mocks.recomputeResolvedPermissions).toHaveBeenCalledTimes(1);
    });

    it('editing a group to remove one member and add another recomputes exactly the union of before and after ids', async () => {
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('הילדים')).toBeInTheDocument());

      fireEvent.click(screen.getByTestId('edit-group-kids'));
      // omer-levy starts checked (current member); uncheck him, check lilit-levy (added).
      fireEvent.click(screen.getByTestId('group-member-checkbox-kids-omer-levy'));
      fireEvent.click(screen.getByTestId('group-member-checkbox-kids-lilit-levy'));
      fireEvent.click(screen.getByTestId('save-group-kids'));

      await waitFor(() => expect(mocks.saveGroup).toHaveBeenCalledWith(
        { id: 'kids', name: 'הילדים', memberIds: ['lilit-levy'] },
        'david-levy',
        ['omer-levy'] // previousMemberIds -> GroupsService arrayRemoves omer, arrayUnions lilit
      ));

      // union(['omer-levy'], ['lilit-levy']) -- BOTH must be recomputed: the removed member
      // (omer-levy) as much as the added one (lilit-levy). Neither more nor fewer than these two.
      await waitFor(() => expect(mocks.recomputeResolvedPermissions).toHaveBeenCalledWith('omer-levy'));
      expect(mocks.recomputeResolvedPermissions).toHaveBeenCalledWith('lilit-levy');
      expect(mocks.recomputeResolvedPermissions).toHaveBeenCalledTimes(2);
    });

    it('deleting a group recomputes every member who was in it (union(before, []) = before)', async () => {
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('הילדים')).toBeInTheDocument());

      fireEvent.click(screen.getByTestId('edit-group-kids'));
      fireEvent.click(screen.getByTestId('delete-group-kids'));

      await waitFor(() => expect(mocks.deleteGroup).toHaveBeenCalledWith('kids', 'david-levy', ['omer-levy']));
      await waitFor(() => expect(mocks.recomputeResolvedPermissions).toHaveBeenCalledWith('omer-levy'));
      expect(mocks.recomputeResolvedPermissions).toHaveBeenCalledTimes(1);
    });

    it('a group write failure shows an error and never calls recompute', async () => {
      mocks.saveGroup.mockRejectedValueOnce(new Error('group write down'));
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('הילדים')).toBeInTheDocument());

      fireEvent.click(screen.getByTestId('edit-group-kids'));
      fireEvent.click(screen.getByTestId('save-group-kids'));

      await waitFor(() => expect(screen.getByText(/שמירת הקבוצה נכשלה/)).toBeInTheDocument());
      expect(mocks.recomputeResolvedPermissions).not.toHaveBeenCalled();
    });

    it('ownerless modules do not offer "own" in the group permission matrix either', async () => {
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('הילדים')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('edit-group-kids'));

      const incomeSelect = screen.getByTestId('group-permission-select-kids-income-view');
      expect(within(incomeSelect).queryByRole('option', { name: 'אישי' })).not.toBeInTheDocument();
      const expensesSelect = screen.getByTestId('group-permission-select-kids-expenses-view');
      expect(within(expensesSelect).queryByRole('option', { name: 'אישי' })).toBeInTheDocument();
    });
  });

  it('does not render any control for changing a member role/claim', async () => {
    render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
    await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
    expect(screen.queryByRole('combobox', { name: /role|תפקיד/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId(/role-select/)).not.toBeInTheDocument();
  });

  describe('edit cannot exceed view — an edit grant you cannot see is not an edit you can perform', () => {
    it('when view is "own", the edit select does not offer "family" as a choice, and shows a Hebrew explanation', async () => {
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));

      const viewSelect = screen.getByTestId('permission-select-omer-levy-accounts-view');
      fireEvent.change(viewSelect, { target: { value: 'own' } });

      const editSelect = screen.getByTestId('permission-select-omer-levy-accounts-edit');
      expect(within(editSelect).queryByRole('option', { name: 'משפחתי' })).not.toBeInTheDocument();
      expect(within(editSelect).queryByRole('option', { name: 'אישי' })).toBeInTheDocument();
      expect(within(editSelect).queryByRole('option', { name: 'ללא' })).toBeInTheDocument();

      // Not a silent snap — an explanation is shown, in Hebrew, consistent with the component's
      // copy, scoped to this row (other rows still at their own default view level may show the
      // same explanation for their own reasons, so this asserts the accounts row specifically).
      const hint = screen.getByTestId('permission-select-omer-levy-accounts-edit-clamp-hint');
      expect(hint).toHaveTextContent('לא ניתן להעניק עריכה רחבה יותר מצפייה');
    });

    it('when view is "none", the edit select only offers "none"', async () => {
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));

      const viewSelect = screen.getByTestId('permission-select-omer-levy-accounts-view');
      fireEvent.change(viewSelect, { target: { value: 'none' } });

      const editSelect = screen.getByTestId('permission-select-omer-levy-accounts-edit');
      expect(within(editSelect).queryByRole('option', { name: 'משפחתי' })).not.toBeInTheDocument();
      expect(within(editSelect).queryByRole('option', { name: 'אישי' })).not.toBeInTheDocument();
      expect(within(editSelect).queryByRole('option', { name: 'ללא' })).toBeInTheDocument();
    });

    it('when view is "family", every edit level is offered with no restriction explanation for that row', async () => {
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));

      const viewSelect = screen.getByTestId('permission-select-omer-levy-accounts-view');
      fireEvent.change(viewSelect, { target: { value: 'family' } });

      const editSelect = screen.getByTestId('permission-select-omer-levy-accounts-edit');
      expect(within(editSelect).queryByRole('option', { name: 'משפחתי' })).toBeInTheDocument();
      expect(within(editSelect).queryByRole('option', { name: 'אישי' })).toBeInTheDocument();
      expect(within(editSelect).queryByRole('option', { name: 'ללא' })).toBeInTheDocument();
      expect(screen.queryByTestId('permission-select-omer-levy-accounts-edit-clamp-hint')).not.toBeInTheDocument();
    });

    it('an out-of-range edit choice is never applied to state — attempting it does not change what would be saved', async () => {
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));

      const viewSelect = screen.getByTestId('permission-select-omer-levy-accounts-view');
      fireEvent.change(viewSelect, { target: { value: 'own' } });

      const editSelect = screen.getByTestId('permission-select-omer-levy-accounts-edit') as HTMLSelectElement;
      // 'family' is not a valid option on this row (view is 'own') — attempting to set it must not
      // silently widen the stored value.
      fireEvent.change(editSelect, { target: { value: 'family' } });
      expect(editSelect.value).not.toBe('family');

      fireEvent.click(screen.getByTestId('save-permissions-omer-levy'));
      await waitFor(() => expect(mocks.saveModulePermissions).toHaveBeenCalled());
      const savedModules = (mocks.saveModulePermissions.mock.calls[0] as any[])[2];
      expect(savedModules.accounts.edit).not.toBe('family');
    });

    it('the restriction on edit choices is limited to that module\'s row — a sibling module at "family" view still offers "family" edit', async () => {
      render(<PermissionsManager actorMemberId="david-levy" role="super-admin" />);
      await waitFor(() => expect(screen.getByText('עומר')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('edit-permissions-omer-levy'));

      fireEvent.change(screen.getByTestId('permission-select-omer-levy-accounts-view'), { target: { value: 'own' } });
      fireEvent.change(screen.getByTestId('permission-select-omer-levy-recurring-view'), { target: { value: 'family' } });

      const recurringEdit = screen.getByTestId('permission-select-omer-levy-recurring-edit');
      expect(within(recurringEdit).queryByRole('option', { name: 'משפחתי' })).toBeInTheDocument();
    });
  });
});
