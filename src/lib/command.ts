import type { Chip, Def } from '../types';
import { DEF_MAP, isFilterDef } from './params';

let seq = 0;
export function nextId(): string {
  seq += 1;
  return `c${Date.now().toString(36)}_${seq}`;
}

/** 库定义 → chip */
export function chipFromDef(def: Def, value: string): Chip {
  if (isFilterDef(def)) {
    return {
      id: nextId(),
      kind: 'filter',
      flag: def.flag,
      value,
      label: def.label,
      note: def.note,
      stream: def.group === 'afilter' ? 'a' : 'v',
      defId: def.id,
    };
  }
  return {
    id: nextId(),
    kind: 'param',
    flag: def.flag,
    value: def.type === 'switch' ? '' : value,
    label: def.label,
    note: def.note,
    defId: def.id,
  };
}

export function inputChip(name: string): Chip {
  return { id: nextId(), kind: 'input', value: name, label: '素材' };
}

export function outputChip(name: string): Chip {
  return { id: nextId(), kind: 'output', value: name, label: '输出' };
}

/** 把 chip 序列化成一行 token 列表 */
function chipTokens(chip: Chip): string[] {
  switch (chip.kind) {
    case 'input':
      return ['-i', chip.value ?? 'input.mp4'];
    case 'output':
      return [chip.value ?? 'out.mp4'];
    case 'custom':
      return chip.raw ?? [];
    case 'param': {
      const flag = chip.flag ?? '';
      const val = chip.value ?? '';
      return val === '' ? [flag] : [flag, val];
    }
    case 'filter': {
      const name = chip.flag ?? '';
      const val = chip.value ?? '';
      return val === '' ? [name] : [`${name}=${val}`];
    }
    default:
      return [];
  }
}

export interface BuildResult {
  /** 传给 ffmpeg.exec 的参数 */
  args: string[];
  /** 展示用命令串 */
  text: string;
  /** 实际使用的输入文件名 */
  inputName: string;
  /** 实际使用的输出文件名 */
  outputName: string;
}

/** 组装命令。规则：输入名未插入时放在最前，输出名未插入时自动放末尾。 */
export function buildCommand(
  chips: Chip[],
  defaultInput: string,
  defaultOutput: string,
): BuildResult {
  const vf: string[] = [];
  const af: string[] = [];
  const tokens: string[] = [];
  let hasInput = false;
  let hasOutput = false;
  let inputName = defaultInput;
  let outputName = defaultOutput;
  let vfPlaced = false;
  let afPlaced = false;

  for (const chip of chips) {
    if (chip.kind === 'input') {
      hasInput = true;
      inputName = chip.value ?? inputName;
      tokens.push('-i', inputName);
    } else if (chip.kind === 'output') {
      hasOutput = true;
      outputName = chip.value ?? outputName;
      tokens.push(outputName);
    } else if (chip.kind === 'filter') {
      const piece = chipTokens(chip)[0];
      if (chip.stream === 'a') {
        af.push(piece);
        if (!afPlaced) {
          afPlaced = true;
          tokens.push('-af', '<chain-a>');
        }
      } else {
        vf.push(piece);
        if (!vfPlaced) {
          vfPlaced = true;
          tokens.push('-vf', '<chain-v>');
        }
      }
    } else {
      tokens.push(...chipTokens(chip));
    }
  }

  // 滤镜链后向替换占位符（保持滤镜在参数序列中的相对位置）
  const finalTokens: string[] = tokens.map((t) =>
    t === '<chain-v>' ? vf.join(',') : t === '<chain-a>' ? af.join(',') : t,
  );

  if (!hasInput) {
    finalTokens.unshift('-i', inputName);
  }
  if (!hasOutput) {
    finalTokens.push(outputName);
  }

  const quoted = finalTokens.map((t) => (/\s/.test(t) ? `"${t}"` : t));
  return { args: finalTokens, text: `ffmpeg ${quoted.join(' ')}`, inputName, outputName };
}

/** 按空格切分但尊重引号 */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const isFlag = (t: string | undefined): boolean =>
  typeof t === 'string' && /^-/.test(t) && !/^-\d/.test(t);

/**
 * 自由输入 → chip 列表。
 * 认识库里的 flag 就带上中文注释；滤镜链按逗号拆成多个滤镜 chip；其余原样保留成自定义参数。
 */
export function parseCommandText(text: string, defaultInput: string): Chip[] {
  let line = text.trim();
  if (/^ffmpeg\b/.test(line)) line = line.slice(6).trim();
  const tokens = tokenize(line);
  const chips: Chip[] = [];
  let i = 0;

  while (i < tokens.length) {
    const t = tokens[i];

    if (t === '-i' && i + 1 < tokens.length) {
      chips.push(inputChip(tokens[i + 1]));
      i += 2;
      continue;
    }

    if ((t === '-vf' || t === '-af') && i + 1 < tokens.length) {
      const stream = t === '-vf' ? 'v' : 'a';
      const chain = tokens[i + 1];
      for (const piece of chain.split(',')) {
        const eq = piece.indexOf('=');
        const name = eq === -1 ? piece : piece.slice(0, eq);
        const value = eq === -1 ? '' : piece.slice(eq + 1);
        const def = Object.values(DEF_MAP).find(
          (d) => d.flag === name && d.group === (stream === 'v' ? 'vfilter' : 'afilter'),
        );
        chips.push(
          def
            ? chipFromDef(def, value)
            : { id: nextId(), kind: 'filter', flag: name, value, label: name, stream, note: '自定义滤镜' },
        );
      }
      i += 2;
      continue;
    }

    if (isFlag(t)) {
      const def = Object.values(DEF_MAP).find((d) => !isFilterDef(d) && d.flag === t);
      const next = tokens[i + 1];
      const hasValue = def ? def.type === 'value' && !isFlag(next) : !isFlag(next);
      const value = hasValue && next !== undefined ? next : '';
      chips.push(
        def
          ? chipFromDef(def, value)
          : { id: nextId(), kind: 'param', flag: t, value, label: t, note: '自定义参数' },
      );
      i += hasValue ? 2 : 1;
      continue;
    }

    // 位置参数 → 输出名
    chips.push(outputChip(t));
    i += 1;
  }

  // 若解析结果里既没有素材也没有输出，补默认的，保证可用
  if (!chips.some((c) => c.kind === 'input')) {
    chips.unshift(inputChip(defaultInput));
  }
  if (!chips.some((c) => c.kind === 'output')) {
    chips.push(outputChip(defaultInput));
  }
  return chips;
}

/** chip 右侧展示的命令片段（UI 用） */
export function tokenOf(chip: Chip): string {
  switch (chip.kind) {
    case 'input':
      return `-i ${chip.value ?? 'input.mp4'}`;
    case 'output':
      return String(chip.value ?? 'out.mp4');
    case 'param':
      return `${chip.flag}${(chip.value ?? '') ? ` ${chip.value}` : ''}`;
    case 'filter':
      return `${chip.flag}${(chip.value ?? '') ? `=${chip.value}` : ''}`;
    case 'custom':
      return (chip.raw ?? []).join(' ');
    default:
      return '';
  }
}
