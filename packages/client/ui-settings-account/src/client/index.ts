/** Account settings registration and reconnecting Remote subscription. */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { StudioState } from '@deepseek-ai/dsh-studio-cloud/types'
import type { AccountView, AccountDetails } from '@deepseek-ai/dsh-deepseek-account/types'
import type { PlatformBridge } from './PlatformOverlay.tsx'
import { ContactConfig, CONTACT_CONFIG_GLOBAL } from '../contact-config.ts'
import { contactUrl } from './contact-url.ts'
import { authorizeUrlWithTheme } from './authorize-url.ts'
import { BrowserLogin } from './browser-login.ts'
import { AccountModelCard } from './AccountModelCard.tsx'
import { AccountOnboarding } from './AccountOnboarding.tsx'
import { AccountPlatformHost, type AccountPlatformHostInjected } from './AccountPlatformHost.tsx'
import { StudioSection, StudioServerSection, StudioOverlay, StudioIntroduction, type StudioInjected, type StudioSnapshot } from './StudioAccount.tsx'
import { AccountMenu } from './AccountMenu.tsx'
import { createPlatformPages, type PlatformPages } from './platform-pages.ts'
import { AccountSection, type AccountSnapshot, type AccountSectionInjected } from './AccountSection.tsx'
import { QuotaStore } from './quota-store.ts'
import { createBonusNoticeController } from './bonus-notices.ts'
import { accountClientMetadata } from './client-metadata.ts'
import { en, zh, type AccountKey } from './locales.ts'
import { AccountQuotaNotice, type AccountQuotaNoticeInjected } from './AccountQuotaNotice.tsx'
import { DESKTOP_ONBOARDING_NAMESPACE, type OnboardingSettings } from '../onboarding-settings.ts'
import { refreshAfterReturn } from './account-refresh.ts'
import { AccountAvatarLoader } from './account-avatar.ts'
export type { AccountSectionInjected, AccountSectionProps } from './AccountSection.tsx'
export type { AccountMenuProps } from './AccountMenu.tsx'
export type { AccountSnapshot } from './AccountSection.tsx'
export type { AccountKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.account': AccountKey }
}

/** Services required by account settings. */
export const inject = ['slots', 'locale', 'remote', 'remote.account', 'remote.studioCloud', 'remote.providerQuota', 'remote.session', 'theme', 'configForms']
/** Register account UI in Desktop and plain Web clients. @param ctx - client plugin context. */
export function apply(ctx: Context): void {
  const desktop = 'dshDesktop' in globalThis
  ctx.effect(() => ctx.locale.register('settings.account', { en, zh }), 'account: dictionaries')
  const t = ctx.locale.bind('settings.account')
  const page = globalThis as Partial<Record<typeof CONTACT_CONFIG_GLOBAL, unknown>>
  const config = ContactConfig(page[CONTACT_CONFIG_GLOBAL] ?? {})
  let snapshot: AccountSnapshot = {
    view: undefined, details: undefined, avatar: undefined, failed: false, loginVisible: false, desktopOnboardingVisible: false,
  }
  // Desktop main opens the authorization page natively; a plain browser opens it in a tab it owns.
  const browser = new BrowserLogin(url => authorizeUrlWithTheme(url, ctx.theme.getTheme().active.colorScheme))
  ctx.effect(() => () => { browser.dispose() }, 'account: pending browser window')
  const listeners = new Set<() => void>()
  const publish = (value: AccountSnapshot) => { snapshot = value; for (const listener of listeners) listener() }
  const avatar = new AccountAvatarLoader((value) => { publish({ ...snapshot, avatar: value }) })
  ctx.effect(() => () => { avatar.dispose() }, 'account: profile picture lifetime')
  /** @returns the client identity for one account call, read at call time so it carries the language and zone in effect then. */
  const client = () => accountClientMetadata(ctx.locale.getSnapshot().active, process.env.DSH_CLIENT_VERSION)
  // The browser half of the notice lifecycle: reads when the account becomes
  // active and on an explicit refresh, and acknowledges an order only after its
  // card reports a presented frame. The Host owns which bonus is unnotified and
  // the server owns the copy.
  const notices = createBonusNoticeController({
    ackRetryDelayMs: config.bonusAckRetryDelayMs,
    ackRetryMaxDelayMs: config.bonusAckRetryMaxDelayMs,
    read: async () => {
      const result = await ctx.remote.account.getUnnotifiedBonuses(client())
      if (!result.ok) throw new Error('account bonus read failed')
      return result.value
    },
    acknowledge: async (accountId, orderId) => {
      const result = await ctx.remote.account.ackBonusNotified(accountId, orderId, client())
      if (!result.ok) throw new Error('account bonus acknowledgement failed')
      return result.value
    },
    publish: (notice) => {
      const { notice: _replaced, ...withoutNotice } = snapshot
      // exactOptionalPropertyTypes distinguishes an absent notice from an undefined one.
      publish(notice === null ? withoutNotice : { ...withoutNotice, notice })
    },
  })
  ctx.effect(() => () => { notices.end() }, 'account: bonus notice lifetime')
  let revision = 0
  let refreshing: Promise<void> | undefined
  const refresh = (): Promise<void> => {
    if (snapshot.view?.status !== 'credential-stored') return Promise.resolve()
    if (refreshing !== undefined) return refreshing
    const generation = revision
    const read = async <K extends keyof AccountDetails>(field: K,
      query: () => Promise<AccountDetails[K] | null>) => {
      let value: AccountDetails[K] | null
      try { value = await query() }
      catch { value = { status: 'failed' } }
      if (value?.status === 'failed') console.error('[deepseek-account] account read failed', { field })
      if (generation === revision && value !== null) publish({ ...snapshot, details: { ...snapshot.details, [field]: value } })
    }
    const request = Promise.all([
      read('profile', async () => {
        const result = await ctx.remote.account.getProfile(client())
        if (!result.ok) throw new Error('account profile failed')
        if (generation === revision && result.value?.status === 'ready') avatar.setUrl(result.value.value.avatarUrl)
        return result.value
      }),
      read('balance', async () => {
        const result = await ctx.remote.account.getBalance(client())
        if (!result.ok) throw new Error('account balance failed')
        return result.value
      }),
    ]).then(() => undefined)
    refreshing = request
    void request.finally(() => { if (refreshing === request) refreshing = undefined })
    return request
  }
  ctx.effect(() => () => { revision++ }, 'account: details request lifetime')
  const stream = ctx.remote.$stream<AccountView>({
    name: 'account', open: signal => ctx.remote.account.watch(signal), ended: () => new Error('account stream ended'),
  })
  let disposed = false
  ctx.effect(() => () => { disposed = true; return stream.dispose() }, 'account: state stream')
  void (async () => {
    for await (const frame of stream) {
      revision++
      refreshing = undefined
      avatar.reset()
      const initialize = frame.value.status === 'credential-stored' && frame.value.attempt?.phase === 'succeeded'
        && snapshot.view?.attempt?.phase !== 'succeeded'
      const { notice, ...previous } = snapshot
      publish({ ...previous, view: frame.value, details: undefined, avatar: undefined, failed: false,
        ...(frame.value.status === 'credential-stored' && notice ? { notice } : {}) })
      browser.update(frame.value)
      frame.accept()
      if (frame.value.status === 'credential-stored') notices.begin()
      else notices.end()
      if (initialize) void (async () => {
        try {
          const initialized = await ctx.remote.session.initializeDefaultModel()
          if (!initialized.ok) console.error('[deepseek-account] default model initialization failed', { reason: 'refused' })
        } catch (_error) {
          console.error('[deepseek-account] default model initialization failed', { reason: 'disconnected' })
        }
      })()
      void refresh()
    }
  })().catch(() => { if (!disposed) publish({ ...snapshot, failed: true }) })
  const nativePlatform = (globalThis as typeof globalThis & { dshPlatform?: PlatformBridge }).dshPlatform
  // One request channel for the single native Platform view. It always exists
  // so every entry can observe whether a page is showing; only a native bridge
  // lets an entry request one.
  const platformPages = createPlatformPages()
  ctx.effect(() => () => { platformPages.dispose() }, 'account: platform page request')
  const quota = new QuotaStore(ctx.remote)
  ctx.effect(() => () => { quota.dispose() }, 'account: provider quota')
  // One account refresh: the recharge/bonus wallet and the unnotified-bonus read,
  // whichever surface asks — a Settings entry, or returning from top-up. Both
  // reads are independent, and a concurrent refresh shares the in-flight request.
  const refreshAccount = async (): Promise<void> => {
    avatar.retry()
    await Promise.all([refresh(), notices.refresh(), quota.refresh()])
  }
  /**
   * Narrow the shared channel to one surface's post-return read: only a viewer
   * returning from top-up re-reads, so a superseded page or a plugin teardown
   * never triggers account work.
   * @param reRead - that surface's read after a returned top-up page.
   * @returns the opener that surface injects.
   */
  const platformPageOpener = (reRead: () => Promise<void>): PlatformPages['open'] =>
    (page, onClose) => platformPages.open(page, (reason) => {
      onClose(reason)
      if (reason === 'returned' && page === 'top-up') void refreshAfterReturn(refreshing, reRead)
    })
  let studioSnapshot: StudioSnapshot = { state:null,visible:false,error:false }
  const studioListeners = new Set<() => void>()
  const publishStudio = (value:StudioSnapshot) => {studioSnapshot=value;for(const listener of studioListeners)listener()}
  let studioGeneration=0
  const refreshStudio = async () => {
    const generation=studioGeneration
    const result = await ctx.remote.studioCloud.getState()
    if(generation!==studioGeneration)return
    if (!result.ok) {publishStudio({ ...studioSnapshot,error:true });return}
    publishStudio({ ...studioSnapshot,state:result.value,error:false }); publish({ ...snapshot,studio:result.value })
  }
  let studioDisposed = false
  let offerFirstUse = () => {}
  let dismissFirstUse = () => {}
  const studio:StudioInjected = {
    hooks: {
      studio: {
        getSnapshot: () => studioSnapshot,
        subscribe: (listener) => {
          studioListeners.add(listener)
          return () => { studioListeners.delete(listener) }
        },
      },
    },
    studioConfigureServer: async (origin) => {
      const result = await ctx.remote.studioCloud.configureServer(origin)
      if (!result.ok) throw result.error
      await refreshStudio()
    },
    studioLogin:async (origin,login,password,device,allowHttp) => {
      studioGeneration++
      const result = await ctx.remote.studioCloud.signIn(origin,login,password,device,allowHttp)
      if (!result.ok) throw result.error
      await refreshStudio()
      publishStudio({ ...studioSnapshot, visible: false })
      dismissFirstUse()
    },
    studioLogout:async () => {
      studioGeneration++
      const { preview:_preview,...next }=studioSnapshot
      publishStudio(next)
      const result = await ctx.remote.studioCloud.signOut()
      if (!result.ok) throw result.error
      await refreshStudio()
      if (!result.value.revoked) throw new Error('Studio device revocation was not confirmed')
    },
    studioChangePassword:async (current,next) => {
      const result = await ctx.remote.studioCloud.changePassword(current,next)
      if (!result.ok) throw result.error
      await refreshStudio()
    },
    studioAction:async (action)=>{
      const result=action.kind==='invite' ? await ctx.remote.studioCloud.acceptInvite(action.origin,action.token,action.username,action.password,action.allowHttp)
        : action.kind==='forgot' ? await ctx.remote.studioCloud.forgotPassword(action.origin,action.email,action.allowHttp)
          : action.kind==='reset' ? await ctx.remote.studioCloud.resetPassword(action.origin,action.token,action.password,action.allowHttp)
            : action.kind==='verify' ? await ctx.remote.studioCloud.verifyEmail(action.origin,action.token,action.allowHttp)
              : await ctx.remote.studioCloud.bindEmail(action.email,action.password)
      if(!result.ok)throw result.error
    },
    studioDevices:async()=>{
      const generation=studioGeneration
      const result=await ctx.remote.studioCloud.devices()
      if(generation!==studioGeneration)return
      if(!result.ok)throw result.error
      publishStudio({ ...studioSnapshot,devices:result.value })
    },
    studioRevoke:async (id)=>{
      const result=await ctx.remote.studioCloud.revokeDevice(id)
      if(!result.ok)throw result.error
      const { devices:_devices,...next }=studioSnapshot
      publishStudio(next)
      await refreshStudio()
    },
    studioHistories:async()=>{
      const generation=studioGeneration
      const result=await ctx.remote.studioCloud.historiesList()
      if(generation!==studioGeneration || studioDisposed)return
      if(!result.ok)throw result.error
      publishStudio({ ...studioSnapshot,histories:result.value })
    },
    studioReadHistory:async (id)=>{
      const generation=studioGeneration
      const result=await ctx.remote.studioCloud.readHistory(id)
      if(generation!==studioGeneration || studioDisposed)return
      if(!result.ok)throw result.error
      publishStudio({ ...studioSnapshot,history:result.value })
    },
    studioProjects:async()=>{
      const generation=studioGeneration
      const result=await ctx.remote.studioCloud.projectsToBind()
      if(generation!==studioGeneration || studioDisposed)return
      if(!result.ok)throw result.error
      publishStudio({ ...studioSnapshot,projects:result.value })
    },
    studioBindProject:async(id,localId)=>{
      const result=await ctx.remote.studioCloud.bindProject(id,localId as WorkspaceId)
      if(!result.ok)throw result.error
      await studio.studioProjects()
    },
    studioUnbindProject:async (id)=>{
      const result=await ctx.remote.studioCloud.unbindProject(id)
      if(!result.ok)throw result.error
      await studio.studioProjects()
    },
    studioForkHistory:async(id,workspaceId,preset)=>{
      const result=await ctx.remote.studioCloud.forkHistory(id,workspaceId as WorkspaceId,...(preset ? [preset] : []))
      if(!result.ok)throw result.error
      publishStudio({ ...studioSnapshot,continuation:result.value })
      return result.value
    },
    studioTokenActivity:async()=>{
      const generation=studioGeneration
      const result=await ctx.remote.studioCloud.tokenActivity()
      if(generation!==studioGeneration || studioDisposed)return
      if(!result.ok)throw result.error
      publishStudio({ ...studioSnapshot,tokenActivity:result.value })
    },
    studioRestoredPlugins:async()=>{
      const generation=studioGeneration
      const result=await ctx.remote.studioCloud.restoredPlugins()
      if(generation!==studioGeneration || studioDisposed)return
      if(!result.ok)throw result.error
      publishStudio({ ...studioSnapshot,restoredPlugins:result.value })
    },
    studioUpdateProfile:async (displayName)=>{
      const result=await ctx.remote.studioCloud.updateProfile(displayName)
      if(!result.ok)throw result.error
      await refreshStudio()
    },
    studioPreview:async()=>{
      const generation=studioGeneration
      const result=await ctx.remote.studioCloud.preview()
      if(generation!==studioGeneration)return
      if(!result.ok)throw result.error
      publishStudio({ ...studioSnapshot,preview:result.value })
    },
    studioSelect:async (choices)=>{
      const result=await ctx.remote.studioCloud.select(choices)
      if(!result.ok)throw result.error
      const { preview:_preview,...next }=studioSnapshot
      publishStudio(next)
      await refreshStudio()
    },
    studioPause:async (paused)=>{
      const result=await ctx.remote.studioCloud.pause(paused)
      if(!result.ok)throw result.error
      await refreshStudio()
    },
    studioUnlockCredentials: async (passphrase) => {
      const result = await ctx.remote.studioCloud.unlockCredentials(passphrase)
      if (!result.ok) throw result.error
      await refreshStudio()
    },
    studioConfigureSync: async (categories, automatic) => {
      const result = await ctx.remote.studioCloud.configureSync(categories, automatic)
      if (!result.ok) throw result.error
      await refreshStudio()
    },
    studioRefresh:async()=>{
      const result=await ctx.remote.studioCloud.synchronize()
      if(!result.ok)throw result.error
      await refreshStudio()
    },
    studioClose:()=>{ publishStudio({ ...studioSnapshot,visible:false }); dismissFirstUse() },
  }
  const studioStream=ctx.remote.$stream<StudioState>({
    name:'studio-cloud',open:signal=>ctx.remote.studioCloud.watch(signal),ended:()=>new Error('Studio account stream ended'),
  })
  ctx.effect(() => () => { studioDisposed = true; return studioStream.dispose() }, 'Studio account status stream')
  void (async () => {
    for await (const frame of studioStream) {
      const previous = studioSnapshot.state
      if (previous?.origin !== frame.value.origin || previous.identity?.id !== frame.value.identity?.id) {
        studioGeneration++
        publishStudio({ state: frame.value, visible: studioSnapshot.visible, error: false })
      } else publishStudio({ ...studioSnapshot, state: frame.value, error: false })
      publish({ ...snapshot, studio: frame.value })
      offerFirstUse()
      frame.accept()
    }
  })().catch(() => {
    if (!studioDisposed) publishStudio({ ...studioSnapshot, error: true })
  })
  ctx.slots.inject('settings.section',()=>ctx.slots.register({
    name:'settings.section',id:'studio-cloud',order:-20,label:()=>t('studioNav'),locale:'settings.account',inject:()=>studio,
  },StudioSection))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'studio-server', order: -21, label: () => t('studioServerConfig'),
    locale: 'settings.account', inject: () => studio,
  }, StudioServerSection))
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register({
    name:'shell.overlay',id:'studio-cloud.login',locale:'settings.account',inject:()=>studio,
  },StudioOverlay))
  const operations: AccountSectionInjected = {
    signOutStudio: () => studio.studioLogout(),
    showStudio:()=>{publishStudio({ ...studioSnapshot,visible:true });void refreshStudio()},
    avatarFailed: (value) => { avatar.failed(value) },
    subscribeSessionExpired: listener => ctx.remote.$on('deepseek-account/session-expired', listener),
    subscribeModelSignInRequired: listener => ctx.remote.$on('deepseek-account/model-sign-in-required', listener),
    ...nativePlatform === undefined ? {} : { openPlatformPage: platformPageOpener(refreshAccount) },
    refreshAccount,
    contactUs() {
      // Sample the account, build and environment before awaiting native information, so
      // a profile the read outlasts cannot replace the UID this click reported.
      const profile = snapshot.details?.profile
      const context = {
        uid: profile?.status === 'ready' ? profile.value.id : null,
        version: process.env.DSH_CLIENT_VERSION,
        width: window.screen.width, height: window.screen.height, pixelRatio: window.devicePixelRatio,
      }
      const openForm = (deviceInfo: string): void => {
        window.open(contactUrl(config, { ...context, deviceInfo }), '_blank', 'noopener,noreferrer')
      }
      const readDeviceInfo = (globalThis as typeof globalThis & {
        dshDesktop?: { deviceInfo?: () => Promise<string> }
      }).dshDesktop?.deviceInfo
      if (readDeviceInfo === undefined) {
        // A plain browser, or a Desktop bridge without the optional reader, reports the renderer user agent.
        openForm(navigator.userAgent)
        return
      }
      void (async () => {
        let deviceInfo = ''
        try { deviceInfo = await readDeviceInfo() }
        catch (_error) {
          // Native information is optional; the questionnaire opens without it.
        }
        openForm(deviceInfo)
      })()
    },
    showLogin(visible) { publish({ ...snapshot, loginVisible: visible }) },
    setOnboarding(active) { publish({ ...snapshot, onboarding: active }) },
    bonusNoticeShown(orderId) { notices.shown(orderId) },
    bonusNoticeDismissed(orderId) { notices.dismiss(orderId) },
    hooks: {
      account: {
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      theme: {
        getSnapshot: () => ctx.theme.getTheme(),
        subscribe: listener => ctx.on('theme/change', listener),
      },
      quota: quota.store,
    },
    refreshQuota: () => quota.refresh(),
    consumeCodexReset: () => quota.consumeReset(),
    dismissQuotaNotice: () => { quota.dismissNotice() },
    async start() {
      publish({ ...snapshot, loginVisible: true, loginFailed: false })
      const transport = (globalThis as typeof globalThis & {
        __DSH_TRANSPORT__?: { streamBaseUrl?: string }
      }).__DSH_TRANSPORT__
      const request = async () => {
        const result = await ctx.remote.account.startSignIn(client(),
          desktop && transport?.streamBaseUrl !== undefined ? new URL(transport.streamBaseUrl).origin : window.location.origin,
          desktop ? 'desktop' : 'web')
        if (!result.ok) throw new Error('account start failed')
        return result.value
      }
      try {
        if (desktop) await request()
        else await browser.start(request, () => snapshot.view)
      } catch (error) {
        publish({ ...snapshot, loginFailed: true })
        throw error
      }
    },
    async cancel(id) { const result = await ctx.remote.account.cancelSignIn(id); if (!result.ok) throw new Error('account cancel failed') },
    async hasRunningAccountTasks() {
      const result = await ctx.remote.account.hasRunningAccountTasks()
      if (!result.ok) throw new Error('account task query failed')
      return result.value
    },
    async signOut() {
      const result = await ctx.remote.account.signOut(client())
      if (result.ok) return
      throw result.error
    },
  }
  const introduction = ctx.configForms.get<OnboardingSettings>(DESKTOP_ONBOARDING_NAMESPACE)
  offerFirstUse = () => {
    if (studioDisposed || studioSnapshot.state === null) return
    const progress = introduction.getSnapshot()
    if (progress.status !== 'ready') return
    const firstUse = progress.value?.step !== 'done' && !studioSnapshot.state.identity
    if (studioSnapshot.firstUse !== firstUse) publishStudio({ ...studioSnapshot, firstUse })
  }
  dismissFirstUse = () => {
    void introduction.mutate([
      { op: 'set', path: ['step'], value: 'done' },
      { op: 'set', path: ['completion'], value: 'skipped' },
    ]).catch((_settingsFailure: unknown) => {
      // The workspace remains available; an unsaved dismissal can be offered again on the next launch.
    })
  }
  ctx.effect(() => {
    const dispose = introduction.subscribe(offerFirstUse)
    void ctx.configForms.describe().ensure().then(offerFirstUse).catch((_settingsFailure: unknown) => {
      // Initial settings failure never blocks local workspace access.
    })
    offerFirstUse()
    return dispose
  }, 'Studio optional first-use prompt')
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding', id: 'studio-introduction', order: -50, locale: 'settings.account', inject: () => studio,
  }, StudioIntroduction))
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card', key: 'llm-deepseek-account',
    locale: 'settings.account', inject: () => operations,
  }, AccountModelCard))
  ctx.slots.inject('settings.models.sign-in', () => ctx.slots.register({
    name: 'settings.models.sign-in', locale: 'settings.account', inject: () => operations,
  }, AccountOnboarding))
  ctx.slots.inject('shell.quota-notice', () => ctx.slots.register({
    name: 'shell.quota-notice', locale: 'settings.account',
    select: owner => owner.code === 'ACCOUNT_QUOTA' ? owner : null,
    inject: (): AccountQuotaNoticeInjected => ({
      hooks: { account: operations.hooks.account, platformPage: platformPages },
      ...nativePlatform === undefined ? {} : { openPlatformPage: platformPageOpener(refreshAccount) },
    }),
  }, AccountQuotaNotice))
  if (nativePlatform !== undefined) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'account.platform-page', locale: 'settings.account',
      inject: (): AccountPlatformHostInjected => ({
        platform: nativePlatform, hooks: { page: platformPages },
        closePage: platformPages.close,
      }),
    }, AccountPlatformHost))
  }
  ctx.slots.inject('settings.launcher', () => ctx.slots.register({
    name: 'settings.launcher', locale: 'settings.account', inject: () => operations,
  }, AccountMenu))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'account', order: -10, label: () => t('nav'),
    locale: 'settings.account', inject: () => operations,
  }, AccountSection))
}
