"use client";
import React, { useMemo, useEffect, useState } from "react";
import { useConfig } from "./ConfigContext";
import { useMessageDecryption } from "@/hooks/useMessageDecryption";
import PathVisualization from "./PathVisualization";
import { PathData } from "@/lib/pathUtils";
import NodeLinkWithHover from "./NodeLinkWithHover";
import { findNodeMentions } from "@/lib/node-utils";
import { useLocale } from "./LocaleProvider";
import { detectMessageRegion } from "@/lib/meshcore";

export interface ChatMessage {
  message_id: string;
  ingest_timestamp: string;
  origins: string[];
  mesh_timestamp: string;
  path_len: number;
  channel_hash: string;
  mac: string;
  encrypted_message: string;
  message_count: number;
  origin_path_info: Array<[string, string, string, number, string, string]>; // Array of [origin, origin_pubkey, path, path_len, broker, topic] tuples
  transport_code: number;
}

interface ChatMessageItemProps {
  msg: ChatMessage;
  showErrorRow?: boolean;
  variant?: "default" | "channel";
}

function formatHex(hex: string): string {
  return hex.replace(/(.{2})/g, "$1 ").trim();
}

function formatLocalTime(utcString: string): string {
  const utcDate = new Date(utcString + (utcString.endsWith('Z') ? '' : 'Z'));
  return utcDate.toLocaleString();
}

function formatTimeOnly(value: string, locale: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getAvatarLabel(sender: string | undefined, fallback: string) {
  const source = (sender || fallback).trim();
  if (!source) return "?";

  return source.replace(/^@/, "").slice(0, 1).toUpperCase();
}

function ChatMessageContent({ text }: { text: string }) {
  // Use utility function to find node mentions
  const nodeMentions = findNodeMentions(text);
  
  // If no node mentions, handle only URLs
  if (nodeMentions.length === 0) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    
    return (
      <>
        {parts.map((part, index) => {
          // Check if it's a URL
          if (/^https?:\/\//.test(part)) {
            return (
              <a
                key={index}
                href={part}
                target="_blank"
                rel="nofollow noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                {part}
              </a>
            );
          }
          return part;
        })}
      </>
    );
  }

  // Process text with both URLs and node mentions
  const combinedRegex = /(https?:\/\/[^\s]+|@\[[^\]]+\])/g;
  const parts = text.split(combinedRegex);
  
  return (
    <>
      {parts.map((part, index) => {
        // Check if it's a URL
        if (/^https?:\/\//.test(part)) {
          return (
            <a
              key={index}
              href={part}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {part}
            </a>
          );
        }
        
        // Check if it's a node mention @[node_name]
        if (/^@\[.+\]$/.test(part)) {
          const nodeName = part.slice(2, -1); // Remove @[ and ]
          return (
            <NodeLinkWithHover 
              key={index}
              nodeName={nodeName}
              exact={true}
            >
              @{nodeName}
            </NodeLinkWithHover>
          );
        }
        
        // Regular text
        return part;
      })}
    </>
  );
}

function ChatMessageItem({ msg, showErrorRow, variant = "default" }: ChatMessageItemProps) {
  const { config } = useConfig();
  const { locale, t } = useLocale();
  const knownKeys = useMemo(() => [
    ...(config?.meshcoreKeys?.map((k: any) => k.privateKey) || []),
    "izOH6cXN6mrJ5e26oRXNcg==", // Always include public key
  ], [config?.meshcoreKeys]);

  const [detectedRegion, setDetectedRegion] = useState<string | null>(null);

  const meshcoreRegions: string[] = useMemo(
    () => config?.meshcoreRegions ?? ['ru', 'ru-kda', 'ru-kda-krd'],
    [config?.meshcoreRegions],
  );

  // Full payload hex for transport code matching: channel_hash + mac + encrypted_message
  const payloadHex = useMemo(
    () => msg.channel_hash + msg.mac + msg.encrypted_message,
    [msg.channel_hash, msg.mac, msg.encrypted_message],
  );

  useEffect(() => {
    let cancelled = false;
    detectMessageRegion(
      msg.transport_code,
      payloadHex,
      meshcoreRegions,
    ).then(region => {
      if (!cancelled) setDetectedRegion(region);
    });
    return () => { cancelled = true; };
  }, [msg.transport_code, payloadHex, meshcoreRegions]);

  const { data: decryptionResult, isLoading } = useMessageDecryption({
    encrypted_message: msg.encrypted_message,
    mac: msg.mac,
    channel_hash: msg.channel_hash,
    knownKeys,
    parse: true,
  });

  const parsed = decryptionResult?.decrypted || null;
  const error = decryptionResult?.error || null;

  const originPathInfo = useMemo(() => 
    msg.origin_path_info && msg.origin_path_info.length > 0 ? msg.origin_path_info : [],
    [msg.origin_path_info]
  );

  // Convert to PathData format for the new component
  const pathData: PathData[] = useMemo(() => 
    originPathInfo.map(([origin, origin_pubkey, path, pathLen]) => ({
      origin,
      pubkey: origin_pubkey,
      path,
      pathLen,
    })),
    [originPathInfo]
  );

  const isChannelVariant = variant === "channel";

  if (parsed) {
    const messageTimestamp = new Date(parsed.timestamp * 1000).toISOString();
    const senderLabel = parsed.sender || msg.channel_hash;

    return (
      <article className={isChannelVariant ? "group flex gap-3 rounded-[26px] px-1 py-2" : "border-b border-gray-200 pb-2 mb-2 dark:border-neutral-800"}>
        {/* {isChannelVariant ? (
          <div className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600/10 text-sm font-semibold text-blue-700 ring-1 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20">
            {getAvatarLabel(parsed.sender, msg.channel_hash)}
          </div>
        ) : null} */}

        <div className="min-w-0 flex-1">
          

          <div className={isChannelVariant ? "rounded-[24px] rounded-tl-md border border-gray-200/80 bg-white/95 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/95" : "break-words whitespace-pre-wrap"}>
            <div className={isChannelVariant ? "mb-2 flex flex-wrap items-center gap-x-2 gap-y-1" : "text-xs text-gray-400 flex items-center gap-2"}>
              <span className={isChannelVariant ? "text-xs text-gray-500 dark:text-gray-400" : "text-xs text-gray-500"}>
                {isChannelVariant ? formatTimeOnly(messageTimestamp, locale) : formatLocalTime(messageTimestamp)}
              </span>
              {parsed.sender ? (
                <NodeLinkWithHover 
                  nodeName={parsed.sender}
                  exact={true}
                >
                  <span className={isChannelVariant ? "font-semibold text-gray-900 dark:text-white" : ""}>{parsed.sender}</span>
                </NodeLinkWithHover>
              ) : (
                isChannelVariant ? <span className="font-semibold text-gray-900 dark:text-white">{senderLabel}</span> : null
              )}
              
              {!isChannelVariant && <span className="text-xs text-gray-500">{t("chatMessage.type")}: {parsed.msgType}</span>}
              {!isChannelVariant && <span className="text-xs text-gray-500 ml-2">{t("chatMessage.channel")}: {msg.channel_hash}</span>}
              {detectedRegion && (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 ring-1 ring-inset ring-indigo-200 dark:ring-indigo-700">
                  {detectedRegion}
                </span>
              )}
              <div className="break-words whitespace-pre-wrap leading-6 text-gray-800 dark:text-gray-100">
                {!isChannelVariant && parsed.sender && ": "}
                <ChatMessageContent text={parsed.text} />
              </div>
            </div>
            
            <div className={isChannelVariant ? "mt-3 border-t border-gray-100 pt-3 dark:border-neutral-800" : ""}>
              <PathVisualization 
                paths={pathData} 
                title={t("chatMessage.heardRepeats", { count: pathData.length })}
                className="text-xs"
                packetHash={msg.message_id}
                channelHash={msg.channel_hash}
              />
            </div>
          </div>
        </div>
      </article>
    );
  }

  if (error) {
    if (showErrorRow) {
      return (
        <article className={isChannelVariant ? "group flex gap-3 rounded-[26px] px-1 py-2" : "border-b border-red-200 pb-2 mb-2 bg-red-50 dark:border-red-800 dark:bg-red-900/30"}>
          <div className="min-w-0 flex-1">
            <div className={isChannelVariant ? "mb-2 flex flex-wrap items-center gap-x-2 gap-y-1" : "text-xs text-gray-400 flex items-center gap-2"}>
              <span className={isChannelVariant ? "font-semibold text-gray-900 dark:text-white" : ""}>{msg.channel_hash}</span>
              <span className={isChannelVariant ? "text-xs text-gray-500 dark:text-gray-400" : "text-xs text-gray-500 ml-2"}>
                {isChannelVariant ? formatTimeOnly(msg.ingest_timestamp, locale) : formatLocalTime(msg.ingest_timestamp)}
              </span>
              {!isChannelVariant && <span className="text-xs text-gray-500 ml-2">{t("chatMessage.channel")}: {msg.channel_hash}</span>}
              {detectedRegion && (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 ring-1 ring-inset ring-indigo-200 dark:ring-indigo-700">
                  {detectedRegion}
                </span>
              )}
            </div>
            <div className={isChannelVariant ? "rounded-[24px] rounded-tl-md border border-red-200/80 bg-red-50/95 p-4 shadow-sm dark:border-red-900/70 dark:bg-red-950/40" : ""}>
              <div className="text-xs text-red-600 dark:text-red-300">
                {error}
              </div>
              <div className={isChannelVariant ? "mt-3 border-t border-red-100 pt-3 dark:border-red-900/50" : ""}>
                <PathVisualization 
                  paths={pathData} 
                  title={t("chatMessage.heardRepeats", { count: pathData.length })}
                  className="text-xs"
                  packetHash={msg.message_id}
                  channelHash={msg.channel_hash}
                />
              </div>
            </div>
          </div>
        </article>
      );
    } else {
      return <></>;
    }
  }

  if (isLoading) {
    return (
      <article className={isChannelVariant ? "group flex gap-3 rounded-[26px] px-1 py-2" : "border-b border-gray-200 pb-2 mb-2 dark:border-neutral-800"}>
        {isChannelVariant ? (
          <div className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gray-200 text-sm font-semibold text-gray-500 dark:bg-neutral-800 dark:text-gray-300">
            …
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className={isChannelVariant ? "mb-2 flex flex-wrap items-center gap-x-2 gap-y-1" : "text-xs text-gray-400 flex items-center gap-2"}>
            <span className={isChannelVariant ? "font-semibold text-gray-900 dark:text-white" : ""}>{msg.channel_hash}</span>
            <span className={isChannelVariant ? "text-xs text-gray-500 dark:text-gray-400" : "text-xs text-gray-500 ml-2"}>
              {isChannelVariant ? formatTimeOnly(msg.ingest_timestamp, locale) : formatLocalTime(msg.ingest_timestamp)}
            </span>
            {!isChannelVariant && <span className="text-xs text-gray-500 ml-2">{t("chatMessage.channel")}: {msg.channel_hash}</span>}
          </div>
          <div className={isChannelVariant ? "rounded-[24px] rounded-tl-md border border-gray-200/80 bg-white/95 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/95" : ""}>
            <div className="my-2 h-5 w-full animate-pulse rounded bg-gray-200 dark:bg-neutral-800" />
            <div className={isChannelVariant ? "mt-3 border-t border-gray-100 pt-3 dark:border-neutral-800" : ""}>
              <PathVisualization 
                paths={pathData} 
                title={t("chatMessage.heardRepeats", { count: pathData.length })}
                className="text-xs"
                packetHash={msg.message_id}
                channelHash={msg.channel_hash}
              />
            </div>
          </div>
        </div>
      </article>
    );
  }

  return null; // This should not be reached now, but kept for safety
}

export default React.memo(ChatMessageItem, (prevProps, nextProps) => {
  // Only re-render if these key properties change
  return (
    prevProps.msg.message_id === nextProps.msg.message_id &&
    prevProps.msg.ingest_timestamp === nextProps.msg.ingest_timestamp &&
    prevProps.msg.encrypted_message === nextProps.msg.encrypted_message &&
    prevProps.msg.mac === nextProps.msg.mac &&
    prevProps.msg.channel_hash === nextProps.msg.channel_hash &&
    prevProps.msg.transport_code === nextProps.msg.transport_code &&
    prevProps.msg.origin_path_info?.length === nextProps.msg.origin_path_info?.length &&
    prevProps.showErrorRow === nextProps.showErrorRow
  );
}); 