// Tipos globales de Liveblocks para los hooks de @liveblocks/react.
import type { LiveList, LiveMap, LiveObject } from '@liveblocks/client';
import type { Presence } from './schema';

declare global {
  interface Liveblocks {
    Presence: Presence;
    Storage: {
      meta: LiveObject<{ name: string; colorMode: string; ready: boolean }>;
      layers: LiveMap<string, LiveObject<any>>;
      artboards: LiveMap<string, LiveObject<any>>;
      guides: LiveMap<string, LiveObject<any>>;
      fonts: LiveMap<string, LiveObject<any>>;
      versions: LiveList<LiveObject<any>>;
    };
    UserMeta: { id: string; info: { name: string; color: string } };
    RoomEvent: { type: 'access-changed'; userId: string };
  }
}
export {};
