/// <reference types="vite/client" />

import type { CerberusApi } from '@shared/ipc'

declare global {
  interface Window {
    cerberus: CerberusApi
  }
}

export {}
