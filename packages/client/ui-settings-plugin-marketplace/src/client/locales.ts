/** Locale bundles for the plugin marketplace settings section. */

/** Locale keys the section renders. */
export type MarketplaceLocaleKey =
  | 'layout'
  | 'layoutCards'
  | 'layoutList'
  | 'copy'
  | 'copied'
  | 'footnotes'
  | 'subtitle'
  | 'enable'
  | 'disable'
  | 'enabled'
  | 'disabled'
  | 'installing'
  | 'uninstalling'
  | 'enabling'
  | 'disabling'
  | 'noticeEnabled'
  | 'noticeDisabled'
  | 'nav'
  | 'title'
  | 'searchPlaceholder'
  | 'sourceAll'
  | 'sourceCommunity'
  | 'sourceCodex'
  | 'tabMarket'
  | 'tabInstalled'
  | 'tabCustom'
  | 'loading'
  | 'empty'
  | 'retry'
  | 'feedFailed'
  | 'results'
  | 'page'
  | 'prev'
  | 'next'
  | 'sortStars'
  | 'sortForks'
  | 'sortUpdated'
  | 'sortAdded'
  | 'installed'
  | 'install'
  | 'uninstall'
  | 'update'
  | 'unsupported'
  | 'verified'
  | 'updateAvailable'
  | 'detail'
  | 'fork'
  | 'close'
  | 'author'
  | 'version'
  | 'source'
  | 'compatibilityFull'
  | 'compatibilityPartial'
  | 'compatibilityUnsupported'
  | 'kindBundle'
  | 'kindSkill'
  | 'kindMcp'
  | 'kindHook'
  | 'kindAll'
  | 'noticeInstalled'
  | 'noticeUninstalled'
  | 'noticeRestart'
  | 'noticeFailed'
  | 'noticeUnsupported'
  | 'noticeIncompatible'
  | 'noticeMissingManager'
  | 'noticeEmptySpec'
  | 'homepage'
  | 'repository'
  | 'customTitle'
  | 'customHint'
  | 'customPlaceholder'
  | 'customInstall'
  | 'catAll'
  | 'catInterface'
  | 'catSession'
  | 'catMemory'
  | 'catTools'
  | 'catAgent'
  | 'catWorkflow'
  | 'catIntegration'
  | 'catModel'
  | 'catDev'
  | 'catKnowledge'
  | 'catFun'
  | 'catInterfaceFull'
  | 'catSessionFull'
  | 'catMemoryFull'
  | 'catToolsFull'
  | 'catAgentFull'
  | 'catWorkflowFull'
  | 'catIntegrationFull'
  | 'catModelFull'
  | 'catDevFull'
  | 'catKnowledgeFull'
  | 'catFunFull'
  | 'timeNow'
  | 'timeMinutes'
  | 'timeHours'
  | 'timeDays'
  | 'timeMonths'
  | 'timeYears'
  | 'timeAgo'

/** English copy. */
export const en: Record<MarketplaceLocaleKey, string> = {
  layout: 'Layout',
  layoutCards: 'Cards',
  layoutList: 'List',
  copy: 'Copy',
  copied: 'Copied',
  footnotes: 'Footnotes',
  subtitle: 'Discover tools and skills from the community and OpenAI',
  enable: 'Enable',
  disable: 'Disable',
  enabled: 'Enabled',
  disabled: 'Disabled',
  installing: 'Installing',
  uninstalling: 'Uninstalling…',
  enabling: 'Enabling…',
  disabling: 'Disabling…',
  noticeEnabled: 'Plugin enabled',
  noticeDisabled: 'Plugin disabled',
  nav: 'Plugin marketplace',
  title: 'Plugin marketplace',
  searchPlaceholder: 'Search name, description, or tags…',
  sourceAll: 'All',
  sourceCommunity: 'Community',
  sourceCodex: 'Codex',
  tabMarket: 'Marketplace',
  tabInstalled: 'Installed',
  tabCustom: 'Custom install',
  loading: 'Loading catalog…',
  empty: 'No plugins match this search.',
  retry: 'Retry',
  feedFailed: 'Could not load the catalog. Check the network and try again.',
  results: '{total} plugins',
  page: 'Page {page} of {pages}',
  prev: 'Previous',
  next: 'Next',
  sortStars: 'Star',
  sortForks: 'Fork',
  sortUpdated: 'Recently updated',
  sortAdded: 'Newly listed',
  installed: 'Installed',
  install: 'Install',
  uninstall: 'Uninstall',
  update: 'Update',
  unsupported: 'Not installable',
  verified: 'Verified',
  updateAvailable: 'Update available',
  detail: 'Details',
  fork: 'Fork',
  close: 'Close',
  author: 'Author',
  version: 'Version',
  source: 'Source',
  compatibilityFull: 'Full',
  compatibilityPartial: 'Partial',
  compatibilityUnsupported: 'Unsupported',
  kindBundle: 'Bundle',
  kindSkill: 'Skill',
  kindMcp: 'MCP',
  kindHook: 'Hook',
  kindAll: 'All kinds',
  noticeInstalled: 'Installed.',
  noticeUninstalled: 'Uninstalled.',
  noticeRestart: 'Restart the application to finish applying the change.',
  noticeFailed: 'Action failed: {message}',
  noticeUnsupported: 'This entry cannot be installed in DSH Studio.',
  noticeIncompatible: 'Incompatible: {message}',
  noticeMissingManager: 'Plugin manager is not available in this profile.',
  noticeEmptySpec: 'Enter a package name, github:owner/repo, or path.',
  homepage: 'Homepage',
  repository: 'Repository',
  customTitle: 'Custom install',
  customHint: 'Install a community bundle by npm name, github:owner/repo, or local path. Codex plugins are installed from the Marketplace tab.',
  customPlaceholder: '@scope/package or github:owner/repo',
  customInstall: 'Install',
  catAll: 'All',
  catInterface: 'UI Exp',
  catSession: 'Sessions',
  catMemory: 'Memory',
  catTools: 'Tools',
  catAgent: 'Agents',
  catWorkflow: 'Workflow',
  catIntegration: 'Integrations',
  catModel: 'Models',
  catDev: 'Dev',
  catKnowledge: 'Knowledge',
  catFun: 'Fun',
  catInterfaceFull: 'UI & Experience',
  catSessionFull: 'Sessions & Messages',
  catMemoryFull: 'Memory & Context',
  catToolsFull: 'Tools & Capabilities',
  catAgentFull: 'Skills & Agents',
  catWorkflowFull: 'Workflow & Automation',
  catIntegrationFull: 'Integrations & Connections',
  catModelFull: 'Models & Reasoning',
  catDevFull: 'Development & Operations',
  catKnowledgeFull: 'Data & Knowledge',
  catFunFull: 'Entertainment',
  timeNow: 'just now',
  timeMinutes: '{n} min',
  timeHours: '{n} h',
  timeDays: '{n} d',
  timeMonths: '{n} mo',
  timeYears: '{n} y',
  timeAgo: 'Updated {t} ago',
}

/** Simplified Chinese copy. */
export const zh: Record<MarketplaceLocaleKey, string> = {
  layout: '布局',
  layoutCards: '卡片',
  layoutList: '列表',
  copy: '复制',
  copied: '已复制',
  footnotes: '脚注',
  subtitle: '发现来自社区和 OpenAI 的工具与技能',
  enable: '启用',
  disable: '禁用',
  enabled: '已启用',
  disabled: '已禁用',
  installing: '安装中',
  uninstalling: '正在卸载…',
  enabling: '正在启用…',
  disabling: '正在禁用…',
  noticeEnabled: '插件已启用',
  noticeDisabled: '插件已禁用',
  nav: '插件市场',
  title: '插件市场',
  searchPlaceholder: '搜索插件名称、描述、标签…',
  sourceAll: '全部',
  sourceCommunity: '社区',
  sourceCodex: 'Codex',
  tabMarket: '插件市场',
  tabInstalled: '已安装',
  tabCustom: '自定义安装',
  loading: '正在加载目录…',
  empty: '没有匹配的插件。',
  retry: '重试',
  feedFailed: '无法加载目录。请检查网络后重试。',
  results: '结果 {total} 条插件',
  page: '第 {page} / {pages} 页',
  prev: '上一页',
  next: '下一页',
  sortStars: 'Star',
  sortForks: 'Fork',
  sortUpdated: '最近更新',
  sortAdded: '最新收录',
  installed: '已安装',
  install: '安装',
  uninstall: '卸载',
  update: '可更新',
  unsupported: '不可安装',
  verified: '已验证',
  updateAvailable: '有更新',
  detail: '详情',
  fork: 'Fork',
  close: '关闭',
  author: '作者',
  version: '版本',
  source: '来源',
  compatibilityFull: '完全兼容',
  compatibilityPartial: '部分兼容',
  compatibilityUnsupported: '暂不支持',
  kindBundle: 'Bundle',
  kindSkill: 'Skill',
  kindMcp: 'MCP',
  kindHook: 'Hook',
  kindAll: '全部类型',
  noticeInstalled: '已安装。',
  noticeUninstalled: '已卸载。',
  noticeRestart: '请重启应用以完成变更。',
  noticeFailed: '操作失败：{message}',
  noticeUnsupported: '该条目无法在 DSH Studio 中安装。',
  noticeIncompatible: '不兼容：{message}',
  noticeMissingManager: '当前 profile 未提供插件管理器。',
  noticeEmptySpec: '请输入包名、github:owner/repo 或本地路径',
  homepage: '主页',
  repository: '仓库',
  customTitle: '自定义安装',
  customHint: '用 npm 包名、github:owner/repo 或本地路径安装社区 bundle。Codex 插件请在「插件市场」页安装。',
  customPlaceholder: '@scope/package 或 github:owner/repo',
  customInstall: '安装',
  catAll: '全部',
  catInterface: '界面体验',
  catSession: '会话消息',
  catMemory: '记忆上下文',
  catTools: '工具能力',
  catAgent: '技能智能体',
  catWorkflow: '工作流',
  catIntegration: '集成连接',
  catModel: '模型推理',
  catDev: '开发运维',
  catKnowledge: '数据知识',
  catFun: '娱乐',
  catInterfaceFull: '界面与体验',
  catSessionFull: '会话与消息',
  catMemoryFull: '记忆与上下文',
  catToolsFull: '工具与能力',
  catAgentFull: '技能与智能体',
  catWorkflowFull: '工作流与自动化',
  catIntegrationFull: '集成与连接',
  catModelFull: '模型与推理',
  catDevFull: '开发与运维',
  catKnowledgeFull: '数据与知识',
  catFunFull: '娱乐',
  timeNow: '刚刚',
  timeMinutes: '{n} 分钟',
  timeHours: '{n} 小时',
  timeDays: '{n} 天',
  timeMonths: '{n} 个月',
  timeYears: '{n} 年',
  timeAgo: '更新于 {t}前',
}
