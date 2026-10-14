/** Copy dictionaries for Codex and Antigravity OAuth on the Models provider card. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  signIn: 'Sign in',
  cancel: 'Cancel',
  signOut: 'Sign out',
  openLink: 'Open sign-in page',
  answer: 'Continue',
  decline: 'Decline',
  promptPlaceholder: 'Enter the requested value',
  statusIdle: 'Not signed in with ChatGPT',
  statusIdleAntigravity: 'Not signed in with Google',
  statusWaiting: 'Continue in your browser',
  statusPrompting: 'Additional information required',
  statusAuthorized: 'Signed in with ChatGPT',
  statusAuthorizedAntigravity: 'Signed in with Google',
  statusFailed: 'Could not sign in',
  statusCancelled: 'Sign-in cancelled',
  signingIn: 'Signing in…',
  actionFailed: 'Could not start sign-in',
  popupBlocked: 'The browser blocked the sign-in page. Use Open sign-in page.',
} as const

/** The settings.oauth namespace key union. */
export type OauthKey = keyof typeof en

/** Chinese strings (same keys as {@link en}). */
export const zh: { [Key in OauthKey]: string } = {
  signIn: '登录',
  cancel: '取消',
  signOut: '退出登录',
  openLink: '打开登录页',
  answer: '继续',
  decline: '拒绝',
  promptPlaceholder: '输入所需内容',
  statusIdle: '尚未登录 ChatGPT',
  statusIdleAntigravity: '尚未登录 Google',
  statusWaiting: '请在浏览器中继续',
  statusPrompting: '需要补充信息',
  statusAuthorized: '已登录 ChatGPT',
  statusAuthorizedAntigravity: '已登录 Google',
  statusFailed: '登录失败',
  statusCancelled: '登录已取消',
  signingIn: '正在登录…',
  actionFailed: '无法开始登录',
  popupBlocked: '浏览器拦截了登录页，请点击「打开登录页」',
}
