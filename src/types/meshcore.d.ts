declare module "@liamcottle/meshcore.js" {
  export class WebBleConnection {
    static open(): Promise<WebBleConnection>;
    on(event: "connected" | "disconnected", handler: () => void): void;
    close(): Promise<void>;
    syncDeviceTime(): Promise<void>;
    getSelfInfo(): Promise<{ name?: string } | null>;
    getChannels(): Promise<Array<{ name: string; channelIdx: number }>>;
    findChannelByName(name: string): Promise<{ name: string; channelIdx: number } | null>;
    setChannel(idx: number, name: string, key: Uint8Array): Promise<void>;
    sendChannelTextMessage(channelIdx: number, text: string): Promise<void>;
  }
  export class WebSerialConnection {
    static open(): Promise<WebSerialConnection>;
  }
}
