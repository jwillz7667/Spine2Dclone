import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { buildAppMenuTemplate } from './app-menu';
import { MENU_ACTION_IDS, type MenuActionId } from '../../shared';

// The application menu is a pure template (Electron-free), so its structure, accelerators, and click
// dispatch are unit-testable without launching the app (the window-options.ts / csp.ts discipline).

function build(isMac: boolean): {
  template: MenuItemConstructorOptions[];
  dispatch: ReturnType<typeof vi.fn>;
} {
  const dispatch = vi.fn();
  return { template: buildAppMenuTemplate({ isMac, dispatch }), dispatch };
}

function topLabels(template: MenuItemConstructorOptions[]): string[] {
  return template.map((item) => item.label ?? `<role:${String(item.role)}>`);
}

function submenuOf(
  template: MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions[] {
  const item = template.find((t) => t.label === label);
  if (item === undefined || !Array.isArray(item.submenu)) {
    throw new Error(`no submenu for "${label}"`);
  }
  return item.submenu;
}

// Every leaf item that carries a click handler, flattened across all submenus.
function clickItems(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = [];
  for (const item of template) {
    if (typeof item.click === 'function') out.push(item);
    if (Array.isArray(item.submenu)) out.push(...clickItems(item.submenu));
  }
  return out;
}

describe('buildAppMenuTemplate', () => {
  it('has the standard top-level menus (File, Edit, View, Tools)', () => {
    const { template } = build(false);
    const labels = topLabels(template);
    for (const menu of ['File', 'Edit', 'View', 'Tools']) {
      expect(labels).toContain(menu);
    }
  });

  it('adds the leading application menu on macOS only', () => {
    expect(build(true).template.some((t) => t.role === 'appMenu')).toBe(true);
    expect(build(false).template.some((t) => t.role === 'appMenu')).toBe(false);
  });

  it('File has New / Open / Save / Import wired to their action ids', () => {
    const { template, dispatch } = build(false);
    const file = submenuOf(template, 'File');
    const labels = file.map((i) => i.label);
    expect(labels).toEqual(
      expect.arrayContaining(['New', 'Open...', 'Save...', 'Import Sprites...']),
    );

    file
      .find((i) => i.label === 'Save...')
      ?.click?.(undefined as never, undefined, undefined as never);
    expect(dispatch).toHaveBeenCalledWith('file:save');
  });

  it('File has Import Spine Project wired to file:importSpine (PP-A5)', () => {
    const { template, dispatch } = build(false);
    const file = submenuOf(template, 'File');
    const item = file.find((i) => i.label === 'Import Spine Project...');
    expect(item).toBeDefined();
    item?.click?.(undefined as never, undefined, undefined as never);
    expect(dispatch).toHaveBeenCalledWith('file:importSpine');
  });

  it('Edit undo/redo dispatch the document actions (not the DOM undo role)', () => {
    const { template, dispatch } = build(false);
    const edit = submenuOf(template, 'Edit');
    const undo = edit.find((i) => i.label === 'Undo');
    const redo = edit.find((i) => i.label === 'Redo');
    expect(undo?.role).toBeUndefined();
    undo?.click?.(undefined as never, undefined, undefined as never);
    redo?.click?.(undefined as never, undefined, undefined as never);
    expect(dispatch).toHaveBeenCalledWith('edit:undo');
    expect(dispatch).toHaveBeenCalledWith('edit:redo');
  });

  it('shows accelerators for discoverability but does NOT register them (renderer owns the shortcut)', () => {
    const { template } = build(false);
    const file = submenuOf(template, 'File');
    const save = file.find((i) => i.label === 'Save...');
    expect(save?.accelerator).toBe('Ctrl+S');
    // registerAccelerator:false means the menu does not steal the shortcut from the renderer keybindings.
    expect(save?.registerAccelerator).toBe(false);
  });

  it('single-key tool shortcuts (V, B) are label-only, never Electron accelerators (no text-field capture)', () => {
    const { template } = build(false);
    const tools = submenuOf(template, 'Tools');
    const select = tools.find((i) => i.label === 'Select (V)');
    expect(select).toBeDefined();
    expect(select?.accelerator).toBeUndefined();
  });

  it('View exposes Reload and Toggle DevTools (so a user can inspect the console)', () => {
    const view = submenuOf(build(false).template, 'View');
    const roles = view.map((i) => i.role);
    expect(roles).toContain('reload');
    expect(roles).toContain('toggleDevTools');
  });

  it('every dispatched action id is a known MenuActionId (menu and contract agree)', () => {
    const { template } = build(true);
    const dispatched: MenuActionId[] = [];
    const spyDispatch = (id: MenuActionId): void => {
      dispatched.push(id);
    };
    const withSpy = buildAppMenuTemplate({ isMac: true, dispatch: spyDispatch });
    for (const item of clickItems(withSpy)) {
      item.click?.(undefined as never, undefined, undefined as never);
    }
    expect(dispatched.length).toBeGreaterThan(0);
    for (const id of dispatched) {
      expect(MENU_ACTION_IDS).toContain(id);
    }
    expect(template.length).toBeGreaterThan(0);
  });
});
