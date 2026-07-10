import type { IDockviewPanelProps } from 'dockview';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import {
  ConstraintError,
  CreateBoneCommand,
  DeleteBoneCommand,
  DeleteIkConstraintCommand,
  DeletePathConstraintCommand,
  DeletePhysicsConstraintCommand,
  DeleteSkinCommand,
  DeleteSlotCommand,
  DeleteTransformConstraintCommand,
  PasteBoneSubtreeCommand,
  RenameBoneCommand,
  RenameIkConstraintCommand,
  RenamePathConstraintCommand,
  RenamePhysicsConstraintCommand,
  RenameSkinCommand,
  RenameSlotCommand,
  RenameTransformConstraintCommand,
  ReparentBoneCommand,
  ReparentCycleError,
  SkinError,
  captureBoneSubtree,
  documentHost,
  type BoneId,
} from '../document';
import { useBoneClipboardStore } from '../editor-state/bone-clipboard-store';
import { useConstraintSelectionStore } from '../editor-state/constraint-selection-store';
import { useSelectionStore } from '../editor-state/selection-store';
import { useSkinPreviewStore } from '../editor-state/skin-preview-store';
import { useSlotSelectionStore } from '../editor-state/slot-selection-store';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import {
  ALL_KINDS_VISIBLE,
  DEFAULT_SKIN_NAME,
  buildConstraintNodes,
  buildSkeletonTree,
  buildSkinNodes,
  canReparent,
  filterSectionNodes,
  filterSkeletonTree,
  isNodeSelected,
  nodeSelectionTarget,
  treeBoneGeometry,
  type HierarchyFilter,
  type HierarchyKindFilter,
  type HierarchyNode,
  type HierarchyNodeKind,
  type HierarchySelectionState,
} from './hierarchy-tree';

const ACCENT = '#5aa0ff';
const NOTICE_DURATION_MS = 4000;
const INDENT_PX = 14;
const CYCLE_NOTICE = 'Cannot reparent a bone under itself or one of its descendants.';

// The hierarchy panel (WP-1.1 core, completed by PP-D7): a depth-indented tree of the WHOLE rig, not just
// bones. It shows bones with their riding slots nested beneath, plus flat sections for constraints
// (ik/transform/path/physics) and skins. Every STRUCTURAL change routes through a document-core command on
// the live History (LAW 2); SELECTING a node is ephemeral editor state that drives the matching selection
// store (the bone, slot, constraint, and skin-preview stores; the document/editor wall, LAW 1). A find box
// (name substring + four kind toggles) narrows the view. Bones additionally support copy/paste/duplicate:
// Ctrl/Cmd+C copies the selected bone's subtree into the ephemeral clipboard, Ctrl/Cmd+V pastes it under
// the selected bone, Ctrl/Cmd+D duplicates in place. All tree-shape, filter, and reparent-validity
// DECISIONS live in the pure hierarchy-tree module; this file is glue, event wiring, and styling.
export function HierarchyPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const model = documentHost.current().model;
  const selectedBoneIds = useSelectionStore((state) => state.selectedBoneIds);
  const selectedSlotId = useSlotSelectionStore((state) => state.selectedSlotId);
  const constraintSelection = useConstraintSelectionStore((state) => state.selection);
  const activeSkin = useSkinPreviewStore((state) => state.activeSkin);
  const clip = useBoneClipboardStore((state) => state.clip);

  // Ephemeral find/filter state (editor state, never serialized): a name substring plus the four kind
  // toggles the pure filter interprets.
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<HierarchyKindFilter>(ALL_KINDS_VISIBLE);
  const filter: HierarchyFilter = useMemo(() => ({ query, kinds }), [query, kinds]);

  const skeleton = useMemo(
    () => buildSkeletonTree<string>(model.bones(), model.slots()),
    [model, revision],
  );
  const constraints = useMemo(
    () =>
      buildConstraintNodes<string>({
        ik: model.ikConstraints(),
        transform: model.transformConstraints(),
        path: model.pathConstraints(),
        physics: model.physicsConstraints(),
      }),
    [model, revision],
  );
  const skins = useMemo(() => buildSkinNodes(model.skins()), [model, revision]);

  const shownSkeleton = useMemo(() => filterSkeletonTree(skeleton, filter), [skeleton, filter]);
  const shownConstraints = useMemo(
    () => filterSectionNodes(constraints, filter),
    [constraints, filter],
  );
  const shownSkins = useMemo(() => filterSectionNodes(skins, filter), [skins, filter]);

  const selectedBoneSet = useMemo(() => new Set<string>(selectedBoneIds), [selectedBoneIds]);
  const primaryBoneId = selectedBoneIds.length > 0 ? selectedBoneIds[0]! : null;

  // The selection state the pure isNodeSelected reads to highlight rows (across the four stores).
  const selectionState: HierarchySelectionState = useMemo(
    () => ({
      boneIds: selectedBoneSet,
      slotId: selectedSlotId,
      constraintKind: constraintSelection?.kind ?? null,
      constraintId: constraintSelection?.id ?? null,
      activeSkin,
    }),
    [selectedBoneSet, selectedSlotId, constraintSelection, activeSkin],
  );

  // A transient, non-blocking message (a rejected reparent, a duplicate constraint name). Auto-clears.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = (message: string): void => {
    setNotice(message);
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
  };
  useEffect(
    () => () => {
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    },
    [],
  );

  // The bone currently being dragged (bone rows only), held in a ref so the drop handler reads it without
  // a re-render and without round-tripping the branded BoneId through dataTransfer.
  const draggedId = useRef<BoneId | null>(null);

  // A right-click context menu anchored at a bone. Null when closed. Bones are the copy/paste/duplicate
  // surface, so the menu lives on bone rows.
  const [menu, setMenu] = useState<{
    readonly x: number;
    readonly y: number;
    readonly id: BoneId;
  } | null>(null);

  // ----- selection routing (ephemeral; the document/editor wall, LAW 1) -----

  function selectBone(id: string, additive: boolean): void {
    const bone = documentHost.current().model.getBone(id as BoneId);
    if (bone) useSelectionStore.getState().click(bone.id, additive);
  }

  function selectSlot(id: string): void {
    const slot = documentHost
      .current()
      .model.slots()
      .find((s) => s.id === id);
    if (slot) useSlotSelectionStore.getState().selectSlot(slot.id);
  }

  function selectConstraint(kind: HierarchyNodeKind, id: string): void {
    const store = useConstraintSelectionStore.getState();
    // A concrete literal per branch so the discriminated ConstraintSelection narrows cleanly.
    if (kind === 'ik') store.select({ kind: 'ik', id });
    else if (kind === 'transform') store.select({ kind: 'transform', id });
    else if (kind === 'path') store.select({ kind: 'path', id });
    else if (kind === 'physics') store.select({ kind: 'physics', id });
  }

  function selectSkin(name: string): void {
    useSkinPreviewStore.getState().setActiveSkin(name);
  }

  // Dispatch a node's click to its store, routing by the pure nodeSelectionTarget decision.
  function selectNode(node: HierarchyNode<string>, additive: boolean): void {
    const target = nodeSelectionTarget(node);
    switch (target.target) {
      case 'bone':
        return selectBone(target.id, additive);
      case 'slot':
        return selectSlot(target.id);
      case 'constraint':
        return selectConstraint(target.kind, target.id);
      case 'skin':
        return selectSkin(target.name);
    }
  }

  // ----- structural commands (LAW 2) -----

  function renameBone(id: string, name: string): void {
    const bone = documentHost.current().model.getBone(id as BoneId);
    if (bone) documentHost.current().history.execute(new RenameBoneCommand(bone.id, name));
  }

  function renameSlot(id: string, name: string): void {
    const slot = documentHost
      .current()
      .model.slots()
      .find((s) => s.id === id);
    if (slot) documentHost.current().history.execute(new RenameSlotCommand(slot.id, name));
  }

  // Rename a constraint through the kind-specific command. A colliding name throws a typed ConstraintError
  // (the command guards uniqueness across all four arrays BEFORE mutating), which is surfaced as a notice
  // rather than crashing the panel.
  function renameConstraint(kind: HierarchyNodeKind, id: string, name: string): void {
    const doc = documentHost.current();
    try {
      if (kind === 'ik') {
        const c = doc.model.ikConstraints().find((x) => x.id === id);
        if (c) doc.history.execute(new RenameIkConstraintCommand(c.id, name));
      } else if (kind === 'transform') {
        const c = doc.model.transformConstraints().find((x) => x.id === id);
        if (c) doc.history.execute(new RenameTransformConstraintCommand(c.id, name));
      } else if (kind === 'path') {
        const c = doc.model.pathConstraints().find((x) => x.id === id);
        if (c) doc.history.execute(new RenamePathConstraintCommand(c.id, name));
      } else if (kind === 'physics') {
        const c = doc.model.physicsConstraints().find((x) => x.id === id);
        if (c) doc.history.execute(new RenamePhysicsConstraintCommand(c.id, name));
      }
    } catch (error) {
      if (error instanceof ConstraintError) {
        showNotice(`Another constraint already uses the name "${name}".`);
        return;
      }
      throw error;
    }
  }

  // Rename a NAMED skin (the implicit default skin is not renamable). A collision throws a typed SkinError,
  // surfaced as a notice. If the renamed skin was the active preview, follow the rename so the viewport
  // keeps previewing it (the preview store keys on the name).
  function renameSkin(currentName: string, name: string): void {
    if (currentName === DEFAULT_SKIN_NAME) return;
    const doc = documentHost.current();
    const skin = doc.model.skins().find((s) => s.name === currentName);
    if (!skin) return;
    const wasActive = useSkinPreviewStore.getState().activeSkin === currentName;
    try {
      doc.history.execute(new RenameSkinCommand(skin.id, name));
    } catch (error) {
      if (error instanceof SkinError) {
        showNotice(`Another skin already uses the name "${name}".`);
        return;
      }
      throw error;
    }
    if (wasActive) useSkinPreviewStore.getState().setActiveSkin(name);
  }

  // Dispatch an inline rename to the right command by node kind.
  function renameNode(node: HierarchyNode<string>, name: string): void {
    switch (node.kind) {
      case 'bone':
        return renameBone(node.id, name);
      case 'slot':
        return renameSlot(node.id, name);
      case 'skin':
        return renameSkin(node.id, name);
      default:
        return renameConstraint(node.kind, node.id, name);
    }
  }

  function deleteBone(id: string): void {
    const bone = documentHost.current().model.getBone(id as BoneId);
    if (bone) documentHost.current().history.execute(new DeleteBoneCommand(bone.id));
  }

  function deleteSlot(id: string): void {
    const slot = documentHost
      .current()
      .model.slots()
      .find((s) => s.id === id);
    if (slot) documentHost.current().history.execute(new DeleteSlotCommand(slot.id));
  }

  function deleteConstraint(kind: HierarchyNodeKind, id: string): void {
    const doc = documentHost.current();
    if (kind === 'ik') {
      const c = doc.model.ikConstraints().find((x) => x.id === id);
      if (c) doc.history.execute(new DeleteIkConstraintCommand(c.id));
    } else if (kind === 'transform') {
      const c = doc.model.transformConstraints().find((x) => x.id === id);
      if (c) doc.history.execute(new DeleteTransformConstraintCommand(c.id));
    } else if (kind === 'path') {
      const c = doc.model.pathConstraints().find((x) => x.id === id);
      if (c) doc.history.execute(new DeletePathConstraintCommand(c.id));
    } else if (kind === 'physics') {
      const c = doc.model.physicsConstraints().find((x) => x.id === id);
      if (c) doc.history.execute(new DeletePhysicsConstraintCommand(c.id));
    }
  }

  // Delete a NAMED skin (default is not deletable). Reset the preview to default first if the deleted skin
  // was active, so the viewport never previews a skin that no longer exists.
  function deleteSkin(currentName: string): void {
    if (currentName === DEFAULT_SKIN_NAME) return;
    const doc = documentHost.current();
    const skin = doc.model.skins().find((s) => s.name === currentName);
    if (!skin) return;
    if (useSkinPreviewStore.getState().activeSkin === currentName) {
      useSkinPreviewStore.getState().reset();
    }
    doc.history.execute(new DeleteSkinCommand(skin.id));
  }

  function deleteNode(node: HierarchyNode<string>): void {
    switch (node.kind) {
      case 'bone':
        return deleteBone(node.id);
      case 'slot':
        return deleteSlot(node.id);
      case 'skin':
        return deleteSkin(node.id);
      default:
        return deleteConstraint(node.kind, node.id);
    }
  }

  // Create a bone under `parent` (or a root). Mirrors the create-bone tool: the id is minted here so redo
  // reuses it, the name defaults to the id, and the command's selectionHint selects the new bone.
  function addBone(parent: BoneId | null): void {
    const doc = documentHost.current();
    const id = doc.ids.mint('bone');
    doc.history.execute(new CreateBoneCommand(id, parent, treeBoneGeometry(id)));
  }

  function addChildBone(id: string): void {
    const bone = documentHost.current().model.getBone(id as BoneId);
    if (bone) addBone(bone.id);
  }

  // ----- bone copy / paste / duplicate (PP-D7) -----

  // Copy a bone's subtree into the ephemeral clipboard as a document-independent value.
  function copyBone(id: string): void {
    const clipValue = captureBoneSubtree(documentHost.current().model, id as BoneId);
    if (clipValue) useBoneClipboardStore.getState().copy(clipValue);
  }

  // Duplicate a bone's subtree in place (paste under the bone's own parent, one undo step).
  function duplicateBone(id: string): void {
    const doc = documentHost.current();
    const bone = doc.model.getBone(id as BoneId);
    if (!bone) return;
    const clipValue = captureBoneSubtree(doc.model, bone.id);
    if (clipValue) doc.history.execute(new PasteBoneSubtreeCommand(clipValue, bone.parent));
  }

  // Paste the clipboard subtree under `targetId` (or as a root when null). The pasted root's selectionHint
  // selects it, which the DocumentHost reconciler applies.
  function pasteUnder(targetId: BoneId | null): void {
    const clipValue = useBoneClipboardStore.getState().clip;
    if (!clipValue) return;
    documentHost.current().history.execute(new PasteBoneSubtreeCommand(clipValue, targetId));
  }

  // ----- bone drag-to-reparent (unchanged from WP-1.1) -----

  function reparentBone(dragged: BoneId, newParent: BoneId | null): void {
    const doc = documentHost.current();
    if (!canReparent(doc.model.bones(), dragged, newParent)) {
      showNotice(CYCLE_NOTICE);
      return;
    }
    try {
      doc.history.execute(new ReparentBoneCommand(dragged, newParent));
    } catch (error) {
      if (error instanceof ReparentCycleError) {
        showNotice(CYCLE_NOTICE);
        return;
      }
      throw error;
    }
  }

  function onDropOnBone(targetId: string): void {
    const dragged = draggedId.current;
    draggedId.current = null;
    if (dragged === null) return;
    reparentBone(dragged, targetId as BoneId);
  }

  function onDropOnRoot(): void {
    const dragged = draggedId.current;
    draggedId.current = null;
    if (dragged === null) return;
    reparentBone(dragged, null);
  }

  function canDropOnBone(targetId: string): boolean {
    const dragged = draggedId.current;
    if (dragged === null) return false;
    return canReparent(documentHost.current().model.bones(), dragged, targetId as BoneId);
  }

  // ----- keyboard: copy / paste / duplicate the selected bone -----

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // Never hijack the browser clipboard while the user is editing a name field.
    if (event.target instanceof HTMLInputElement) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'c' && primaryBoneId !== null) {
      event.preventDefault();
      copyBone(primaryBoneId);
    } else if (key === 'v' && clip !== null) {
      event.preventDefault();
      pasteUnder(primaryBoneId);
    } else if (key === 'd' && primaryBoneId !== null) {
      event.preventDefault();
      duplicateBone(primaryBoneId);
    }
  }

  const boneCount = model.bones().length;

  return (
    <div style={rootStyle} tabIndex={0} onKeyDown={onKeyDown}>
      <div style={toolbarStyle}>
        <button type="button" style={buttonStyle} onClick={() => addBone(primaryBoneId)}>
          Add Bone
        </button>
        {clip !== null && (
          <button
            type="button"
            style={buttonStyle}
            title="Paste the copied bone under the selected bone (Cmd or Ctrl V)"
            onClick={() => pasteUnder(primaryBoneId)}
          >
            Paste
          </button>
        )}
        <span style={countStyle}>
          {boneCount} {boneCount === 1 ? 'bone' : 'bones'}
        </span>
      </div>

      <div style={filterBarStyle}>
        <input
          type="text"
          value={query}
          placeholder="Filter by name"
          spellCheck={false}
          style={filterInputStyle}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {KIND_TOGGLES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            style={kinds[key] ? { ...kindChipStyle, ...kindChipOnStyle } : kindChipStyle}
            title={`Toggle ${label}`}
            onClick={() => setKinds((prev) => ({ ...prev, [key]: !prev[key] }))}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={listStyle}>
        {boneCount === 0 && (
          <div style={emptyStyle}>No bones. Add one to start rigging (WP-1.1).</div>
        )}

        {shownSkeleton.map((node) => (
          <TreeRow
            key={`${node.kind}:${node.id}`}
            node={node}
            isSelected={isNodeSelected(node, selectionState)}
            isPrimaryBone={node.kind === 'bone' && node.id === primaryBoneId}
            onSelect={(additive) => selectNode(node, additive)}
            onRename={(name) => renameNode(node, name)}
            onDelete={() => deleteNode(node)}
            bone={
              node.kind === 'bone'
                ? {
                    onAddChild: () => addChildBone(node.id),
                    onContextMenu: (x, y) => setMenu({ x, y, id: node.id as BoneId }),
                    onDragStart: () => {
                      draggedId.current = node.id as BoneId;
                    },
                    onDragEnd: () => {
                      draggedId.current = null;
                    },
                    onDrop: () => onDropOnBone(node.id),
                    canDrop: () => canDropOnBone(node.id),
                  }
                : undefined
            }
          />
        ))}

        {shownConstraints.length > 0 && <div style={sectionHeaderStyle}>Constraints</div>}
        {shownConstraints.map((node) => (
          <TreeRow
            key={`${node.kind}:${node.id}`}
            node={node}
            isSelected={isNodeSelected(node, selectionState)}
            isPrimaryBone={false}
            onSelect={() => selectNode(node, false)}
            onRename={(name) => renameNode(node, name)}
            onDelete={() => deleteNode(node)}
          />
        ))}

        {shownSkins.length > 0 && <div style={sectionHeaderStyle}>Skins</div>}
        {shownSkins.map((node) => {
          const isDefault = node.id === DEFAULT_SKIN_NAME;
          return (
            <TreeRow
              key={`skin:${node.id}`}
              node={node}
              isSelected={isNodeSelected(node, selectionState)}
              isPrimaryBone={false}
              readOnly={isDefault}
              onSelect={() => selectNode(node, false)}
              onRename={(name) => renameNode(node, name)}
              onDelete={() => deleteNode(node)}
            />
          );
        })}
      </div>

      <div
        style={rootDropStyle}
        title="Drop a bone here to make it a root"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => {
          event.preventDefault();
          onDropOnRoot();
        }}
      >
        Drop here to make a root bone
      </div>

      {notice !== null && <div style={noticeStyle}>{notice}</div>}

      {menu !== null && (
        <BoneContextMenu
          x={menu.x}
          y={menu.y}
          hasClip={clip !== null}
          onClose={() => setMenu(null)}
          onDuplicate={() => duplicateBone(menu.id)}
          onCopy={() => copyBone(menu.id)}
          onPaste={() => pasteUnder(menu.id)}
          onAddChild={() => addChildBone(menu.id)}
          onDelete={() => deleteBone(menu.id)}
        />
      )}
    </div>
  );
}

// The four kind-filter toggles, in tree order.
const KIND_TOGGLES: readonly { readonly key: keyof HierarchyKindFilter; readonly label: string }[] =
  [
    { key: 'bones', label: 'Bones' },
    { key: 'slots', label: 'Slots' },
    { key: 'constraints', label: 'Constraints' },
    { key: 'skins', label: 'Skins' },
  ];

// A short badge glyph per node kind, so the tree reads at a glance without icons or emoji.
const KIND_BADGE: Record<HierarchyNodeKind, string> = {
  bone: 'B',
  slot: 'S',
  ik: 'IK',
  transform: 'TC',
  path: 'PC',
  physics: 'PH',
  skin: 'SK',
};

interface BoneRowExtras {
  readonly onAddChild: () => void;
  readonly onContextMenu: (x: number, y: number) => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onDrop: () => void;
  readonly canDrop: () => boolean;
}

interface TreeRowProps {
  readonly node: HierarchyNode<string>;
  readonly isSelected: boolean;
  readonly isPrimaryBone: boolean;
  readonly onSelect: (additive: boolean) => void;
  readonly onRename: (name: string) => void;
  readonly onDelete: () => void;
  // Present only for bone nodes: drag-to-reparent, add-child, and the context menu trigger.
  readonly bone?: BoneRowExtras | undefined;
  // A read-only node cannot be renamed or deleted (the implicit default skin).
  readonly readOnly?: boolean | undefined;
}

// One tree row: a kind badge, an inline-editable name (or a static label when read-only), a selection
// highlight, and a delete affordance. Bone rows add drag-to-reparent, an add-child button, and a
// right-click context menu. The name field is UNCONTROLLED and keyed by its committed value plus a nonce
// (the animation-panel pattern): a committed rename or an undo/redo/load remounts it to the live value.
function TreeRow(props: TreeRowProps): ReactElement {
  const { node, isSelected, isPrimaryBone, bone, readOnly } = props;
  const [resetNonce, setResetNonce] = useState(0);
  const revert = (): void => setResetNonce((nonce) => nonce + 1);

  function commitName(raw: string): void {
    const next = raw.trim();
    if (next === '' || next === node.name) {
      revert();
      return;
    }
    props.onRename(next);
  }

  const rowStyleFinal: CSSProperties = {
    ...(isSelected ? { ...rowStyle, ...rowActiveStyle } : rowStyle),
    ...(isPrimaryBone ? rowPrimaryStyle : null),
    paddingLeft: 8 + node.depth * INDENT_PX,
  };

  return (
    <div
      draggable={bone !== undefined}
      title={
        bone !== undefined
          ? 'Drag to reparent, click to select, right click for more'
          : 'Click to select'
      }
      style={rowStyleFinal}
      onClick={(event) => props.onSelect(event.shiftKey || event.metaKey || event.ctrlKey)}
      onContextMenu={
        bone !== undefined
          ? (event) => {
              event.preventDefault();
              bone.onContextMenu(event.clientX, event.clientY);
            }
          : undefined
      }
      onDragStart={
        bone !== undefined
          ? (event) => {
              event.dataTransfer.effectAllowed = 'move';
              bone.onDragStart();
            }
          : undefined
      }
      onDragEnd={bone !== undefined ? () => bone.onDragEnd() : undefined}
      onDragOver={
        bone !== undefined
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = bone.canDrop() ? 'move' : 'none';
            }
          : undefined
      }
      onDrop={
        bone !== undefined
          ? (event) => {
              event.preventDefault();
              bone.onDrop();
            }
          : undefined
      }
    >
      <span style={badgeStyle}>{KIND_BADGE[node.kind]}</span>

      {readOnly === true ? (
        <span style={readOnlyNameStyle}>{node.name}</span>
      ) : (
        <input
          key={`name:${node.name}:${resetNonce}`}
          type="text"
          defaultValue={node.name}
          spellCheck={false}
          style={nameInputStyle}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.currentTarget.value = node.name;
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => commitName(event.currentTarget.value)}
        />
      )}

      {bone !== undefined && (
        <button
          type="button"
          style={smallButtonStyle}
          title="Add child bone"
          onClick={(event) => {
            event.stopPropagation();
            bone.onAddChild();
          }}
        >
          +
        </button>
      )}
      {readOnly !== true && (
        <button
          type="button"
          style={smallButtonStyle}
          title="Delete"
          onClick={(event) => {
            event.stopPropagation();
            props.onDelete();
          }}
        >
          Del
        </button>
      )}
    </div>
  );
}

interface BoneContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly hasClip: boolean;
  readonly onClose: () => void;
  readonly onDuplicate: () => void;
  readonly onCopy: () => void;
  readonly onPaste: () => void;
  readonly onAddChild: () => void;
  readonly onDelete: () => void;
}

// A lightweight bone context menu (PP-D7): the copy/paste/duplicate surface plus add-child and delete. A
// full-screen transparent overlay behind it closes it on any outside click.
function BoneContextMenu(props: BoneContextMenuProps): ReactElement {
  const run = (action: () => void) => (): void => {
    action();
    props.onClose();
  };
  return (
    <div
      style={menuOverlayStyle}
      onClick={props.onClose}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        style={{ ...menuStyle, left: props.x, top: props.y }}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" style={menuItemStyle} onClick={run(props.onDuplicate)}>
          Duplicate
        </button>
        <button type="button" style={menuItemStyle} onClick={run(props.onCopy)}>
          Copy
        </button>
        <button
          type="button"
          style={props.hasClip ? menuItemStyle : menuItemDisabledStyle}
          disabled={!props.hasClip}
          onClick={props.hasClip ? run(props.onPaste) : undefined}
        >
          Paste here
        </button>
        <button type="button" style={menuItemStyle} onClick={run(props.onAddChild)}>
          Add child bone
        </button>
        <button type="button" style={menuItemStyle} onClick={run(props.onDelete)}>
          Delete
        </button>
      </div>
    </div>
  );
}

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  background: '#1b1b1b',
  color: '#dddddd',
  fontSize: 12,
  outline: 'none',
};

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderBottom: '1px solid #333333',
  flex: '0 0 auto',
};

const filterBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 8px',
  borderBottom: '1px solid #262626',
  flex: '0 0 auto',
  flexWrap: 'wrap',
};

const filterInputStyle: CSSProperties = {
  flex: '1 1 120px',
  minWidth: 0,
  fontSize: 12,
  color: '#eeeeee',
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '3px 6px',
};

const kindChipStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '2px 6px',
  fontSize: 10,
  color: '#999999',
  background: '#242424',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  cursor: 'pointer',
};

const kindChipOnStyle: CSSProperties = {
  color: '#e8e8e8',
  background: '#2d3f57',
  borderColor: ACCENT,
};

const countStyle: CSSProperties = { marginLeft: 'auto', color: '#888888' };

const listStyle: CSSProperties = { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' };

const emptyStyle: CSSProperties = { color: '#777777', padding: 12 };

const sectionHeaderStyle: CSSProperties = {
  padding: '4px 8px',
  marginTop: 4,
  fontSize: 10,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  color: '#888888',
  background: '#202020',
  borderTop: '1px solid #333333',
  borderBottom: '1px solid #2a2a2a',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 8px',
  borderBottom: '1px solid #262626',
  cursor: 'pointer',
  userSelect: 'none',
};

const rowActiveStyle: CSSProperties = {
  background: '#26354a',
  boxShadow: `inset 2px 0 0 ${ACCENT}`,
};

const rowPrimaryStyle: CSSProperties = {
  boxShadow: `inset 3px 0 0 #ffffff`,
};

const badgeStyle: CSSProperties = {
  flex: '0 0 auto',
  minWidth: 20,
  textAlign: 'center',
  fontSize: 9,
  fontWeight: 600,
  color: '#9fb4cc',
  background: '#232a33',
  border: '1px solid #33404d',
  borderRadius: 3,
  padding: '1px 3px',
};

const nameInputStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 12,
  color: '#eeeeee',
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '2px 6px',
};

const readOnlyNameStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 12,
  color: '#bbbbbb',
  padding: '2px 6px',
};

const buttonStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  color: '#dddddd',
  background: '#2d2d2d',
  border: '1px solid #444444',
  borderRadius: 4,
  cursor: 'pointer',
};

const smallButtonStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '3px 8px',
  fontSize: 11,
  color: '#dddddd',
  background: '#2d2d2d',
  border: '1px solid #444444',
  borderRadius: 4,
  cursor: 'pointer',
};

const rootDropStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '6px 8px',
  borderTop: '1px solid #333333',
  color: '#777777',
  textAlign: 'center',
  fontSize: 11,
};

const noticeStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '6px 8px',
  borderTop: '1px solid #5a4a2a',
  background: '#3a2f1a',
  color: '#e8c98a',
};

const menuOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
};

const menuStyle: CSSProperties = {
  position: 'fixed',
  minWidth: 150,
  display: 'flex',
  flexDirection: 'column',
  background: '#242424',
  border: '1px solid #444444',
  borderRadius: 4,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
  padding: 4,
};

const menuItemStyle: CSSProperties = {
  textAlign: 'left',
  padding: '5px 10px',
  fontSize: 12,
  color: '#dddddd',
  background: 'transparent',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
};

const menuItemDisabledStyle: CSSProperties = {
  ...menuItemStyle,
  color: '#666666',
  cursor: 'default',
};
