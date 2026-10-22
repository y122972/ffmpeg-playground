/** 素材文件在 ffmpeg 侧的默认文件名 */
export type ChipKind = 'param' | 'filter' | 'input' | 'output' | 'custom';

/**
 * chip 是命令的最小单位。
 * - param:  `-flag value`
 * - filter: 自动合并进 -vf / -af 链
 * - input:  `-i input.<ext>`
 * - output: 输出文件名（位置参数，放在哪就是哪个输出）
 * - custom: 从自由输入解析出来的、库里没有的原始参数
 */
export interface Chip {
  id: string;
  kind: ChipKind;
  /** 参数形式，如 `-c:v`；filter 形式为滤镜名，如 `scale` */
  flag?: string;
  /** 值；开关参数为空字符串/undefined */
  value?: string;
  /** chip 上显示的中文名 */
  label: string;
  /** 中文注释 */
  note?: string;
  /** 滤镜所属流 */
  stream?: 'v' | 'a';
  /** 库定义 id，用于编辑时回查 */
  defId?: string;
  /** custom chip 的原始 token 列表 */
  raw?: string[];
}

export type ParamGroup =
  | 'input'
  | 'video'
  | 'audio'
  | 'mux'
  | 'advanced'
  | 'vfilter'
  | 'afilter';

export interface EnumOption {
  label: string;
  value: string;
}

/** 选项/滤镜的库定义。type 决定 chip 是否需要取值。 */
export interface Def {
  id: string;
  /** 参数：`-c:v`；滤镜：`scale` */
  flag: string;
  label: string;
  note: string;
  group: ParamGroup;
  /** 常用度，越小越靠前 */
  rank: number;
  type: 'value' | 'switch';
  stream?: 'v' | 'a';
  enum?: EnumOption[];
  placeholder?: string;
  example?: string;
}

/** 规则命中的提示。fix 是纯数据描述，由 App 负责执行，规则本身保持可测。 */
export interface RuleItem {
  id: string;
  level: 'warn' | 'info';
  text: string;
  fix?: {
    label: string;
    /** 追加 chip */
    add?: { defId: string; value: string }[];
    /** 把同名参数的已有 chip 改成新值 */
    setValue?: { flag: string; value: string }[];
  };
}

export type RunPhase =
  | 'idle'
  | 'loading-core'
  | 'writing'
  | 'running'
  | 'done'
  | 'aborted'
  | 'error';

export interface RunResult {
  name: string;
  blob: Blob;
  url: string;
  mime: string;
}
