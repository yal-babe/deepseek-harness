/** Windows system tray: the always-present way back to a hidden window and the explicit quit entry. */

import { Menu, nativeImage, Tray } from 'electron'
import type { DesktopLocale } from './locale.ts'

/** Main-process actions the tray triggers; both run the same paths as the window and application menu. */
export interface DesktopTrayOptions {
  /** Multi-size ICO rendered by `scripts/render-tray-icon.ts`; Windows picks the bitmap for the display scale. */
  readonly iconPath: string
  readonly locale: () => DesktopLocale
  /** Show and focus the primary window. */
  readonly open: () => void
  /** Request quit through the same confirmation as every other quit entry. */
  readonly quit: () => void
  /** Studio Pet toggle; omitted when the pet window is disabled. */
  readonly pet?: DesktopTrayPet | undefined
}

/** Studio Pet state and action behind the tray's Show / Hide desktop pet entry. */
export interface DesktopTrayPet {
  /** Host "show desktop pet" value; `undefined` until the pet window reports it, which disables the entry. */
  readonly visible: () => boolean | undefined
  /**
   * Change the Host value.
   * @param visible - wanted visibility.
   */
  readonly setVisible: (visible: boolean) => void
}

/** Tray icon present for the whole run, not only while the window is hidden. */
export class DesktopTray {
  private tray: Tray | undefined

  /** @param options - Icon path, locale reader, and the open and quit actions. */
  constructor(private readonly options: DesktopTrayOptions) {
    const tray = new Tray(nativeImage.createFromPath(options.iconPath))
    this.tray = tray
    tray.on('click', () => { options.open() })
    this.relabel()
  }

  /** Rebuild the tooltip and context menu in the current locale. */
  relabel(): void {
    const tray = this.tray
    if (tray === undefined) return
    const { messages } = this.options.locale()
    tray.setToolTip(messages.aboutProduct)
    const pet = this.options.pet
    const petVisible = pet?.visible()
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: messages.openApplication, click: () => { this.options.open() } },
      ...pet === undefined ? [] : [{
        label: petVisible === false ? messages.showPet : messages.hidePet,
        enabled: petVisible !== undefined,
        click: () => { pet.setVisible(petVisible === false) },
      }],
      { type: 'separator' },
      { label: messages.quitApplication, click: () => { this.options.quit() } },
    ]))
  }

  /** Remove the icon; called once the quit is confirmed so no dead icon outlives the process. */
  dispose(): void {
    const tray = this.tray
    this.tray = undefined
    tray?.destroy()
  }
}
