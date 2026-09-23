import type { PlayroomApi } from './index'

declare global {
  interface Window {
    playroom: PlayroomApi
  }
}
