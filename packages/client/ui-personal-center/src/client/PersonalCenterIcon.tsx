/** Sidebar Personal Center glyph. */

import type { ReactNode } from 'react'
import { IconUserOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the user glyph at the size the sidebar asks for.
 * @param props - sidebar icon share.
 */
export function PersonalCenterIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconUserOutlineRegular size={size} />
}
