import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Chip } from '../types';
import { ChevronDown, ChevronUp, Grip, Pencil, X } from './icons';
import { tokenOf } from '../lib/command';

interface Props {
  chips: Chip[];
  onReorder: (chips: Chip[]) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
  onRemove: (id: string) => void;
  onEdit: (chip: Chip) => void;
  onAppendIO: (kind: 'input' | 'output') => void;
}

export function ChipList({ chips, onReorder, onMove, onRemove, onEdit, onAppendIO }: Props) {
  // 长按 180ms 才激活拖动：先解决手机上「想拖却先滚了页面」的冲突
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = chips.findIndex((c) => c.id === active.id);
    const to = chips.findIndex((c) => c.id === over.id);
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(chips, from, to));
  };

  // 中文无障碍播报：读屏用户也能知道拖到了第几位
  const announcements: Announcements = {
    onDragStart(p) {
      const i = chips.findIndex((c) => c.id === p.active.id);
      return `抓起第 ${i + 1} 个参数：${chips[i]?.label ?? ''}`;
    },
    onDragOver(p) {
      if (!p.over || p.active.id === p.over.id) return;
      const i = chips.findIndex((c) => c.id === p.over?.id);
      return `移到第 ${i + 1} 位`;
    },
    onDragEnd(p) {
      if (!p.over) return '放回原位';
      const i = chips.findIndex((c) => c.id === p.over?.id);
      return `已放到第 ${i + 1} 位`;
    },
    onDragCancel() {
      return '取消拖动';
    },
  };

  if (chips.length === 0) {
    return (
      <div className="chips-empty">
        <p>还没有参数。点「+ 添加参数」开始，或者下面挑个快速配方。</p>
        <div className="chips-empty-io">
          <button type="button" className="btn ghost" onClick={() => onAppendIO('input')}>
            插入素材名
          </button>
          <button type="button" className="btn ghost" onClick={() => onAppendIO('output')}>
            插入输出名
          </button>
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ announcements }}
    >
      <SortableContext items={chips.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul className="chips" aria-label="参数列表">
          {chips.map((chip, index) => (
            <SortableChip
              key={chip.id}
              chip={chip}
              index={index}
              total={chips.length}
              onEdit={onEdit}
              onMove={onMove}
              onRemove={onRemove}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

interface ChipProps {
  chip: Chip;
  index: number;
  total: number;
  onEdit: (chip: Chip) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
  onRemove: (id: string) => void;
}

function SortableChip({ chip, index, total, onEdit, onMove, onRemove }: ChipProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: chip.id,
  });
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 5 : undefined,
  } as const;

  const badge =
    chip.kind === 'input'
      ? '输入'
      : chip.kind === 'output'
        ? '输出'
        : chip.kind === 'filter'
          ? chip.stream === 'a'
            ? '音频链'
            : '视频链'
          : chip.kind === 'param' && (chip.value ?? '') === ''
            ? '开关'
            : null;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`chip${isDragging ? ' dragging' : ''}`}
      data-kind={chip.kind}
      data-testid="chip"
    >
      {/* 只有手柄响应拖动；chip 本体点了是编辑 */}
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="chip-grip"
        aria-label="拖动排序"
        title="长按拖动排序"
        {...attributes}
        {...listeners}
      >
        <Grip />
      </button>

      <button type="button" className="chip-body" onClick={() => onEdit(chip)} aria-label={`编辑 ${chip.label}`}>
        <span className="chip-label">{chip.label}</span>
        <code className="chip-token">{tokenOf(chip)}</code>
        {badge ? <span className={`chip-badge${badge === '开关' ? ' soft' : ''}`}>{badge}</span> : null}
      </button>

      <div className="chip-actions" ref={menuRef}>
        <button
          type="button"
          className="chip-more"
          aria-label="更多操作"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu((v) => !v)}
        >
          ⋯
        </button>
        {menu ? (
          <div className="chip-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              disabled={index === 0}
              onClick={() => {
                onMove(chip.id, 'up');
                setMenu(false);
              }}
            >
              <ChevronUp size={16} />
              上移
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={index === total - 1}
              onClick={() => {
                onMove(chip.id, 'down');
                setMenu(false);
              }}
            >
              <ChevronDown size={16} />
              下移
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                onEdit(chip);
              }}
            >
              <Pencil size={16} />
              编辑
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                onRemove(chip.id);
                setMenu(false);
              }}
            >
              <X size={16} />
              删除
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
