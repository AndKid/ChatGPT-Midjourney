import { create } from "zustand";
import { persist } from "zustand/middleware";

import { trimTopic } from "../utils";

import Locale, { getLang } from "../locales";
import { showToast } from "../components/ui-lib";
import {
  checkFlag,
  ModelConfig,
  ModelType,
  personModel,
  useAppConfig,
  voiceCheck,
} from "./config";
import { createEmptyMask, Mask } from "./mask";
import {
  DEFAULT_INPUT_TEMPLATE,
  DEFAULT_SYSTEM_TEMPLATE,
  StoreKey,
} from "../constant";
import {
  api,
  getHeaders,
  RequestMessage,
  useGetMidjourneySelfProxyUrl,
} from "../client/api";
import { ChatControllerPool } from "../client/controller";
import { prettyObject } from "../utils/format";
import { estimateTokenLength } from "../utils/token";
import { nanoid } from "nanoid";
import { useAccessStore } from "./access";
import { getServerSideConfig } from "../config/server";

export type ChatMessage = RequestMessage & {
  date: string;
  streaming?: boolean;
  isError?: boolean;
  id: string;
  model?: ModelType;
  attr?: any;
};

export function createMessage(override: Partial<ChatMessage>): ChatMessage {
  return {
    id: nanoid(),
    date: new Date().toLocaleString(),
    role: "user",
    content: "",
    ...override,
  };
}

export interface ChatStat {
  tokenCount: number;
  wordCount: number;
  charCount: number;
}

export interface ChatSession {
  id: string;
  topic: string;

  memoryPrompt: string;
  messages: ChatMessage[];
  stat: ChatStat;
  lastUpdate: number;
  lastSummarizeIndex: number;
  clearContextIndex?: number;

  mask: Mask;
}

export const DEFAULT_TOPIC = Locale.Store.DefaultTopic;
export const BOT_HELLO: ChatMessage = createMessage({
  role: "assistant",
  content: Locale.Store.BotHello,
});

function createEmptySession(): ChatSession {
  return {
    id: nanoid(),
    topic: DEFAULT_TOPIC,
    memoryPrompt: "",
    messages: [],
    stat: {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
    },
    lastUpdate: Date.now(),
    lastSummarizeIndex: 0,

    mask: createEmptyMask(),
  };
}

const ChatFetchTaskPool: Record<string, any> = {};

interface ChatStore {
  sessions: ChatSession[];
  currentSessionIndex: number;
  clearSessions: () => void;
  moveSession: (from: number, to: number) => void;
  selectSession: (index: number) => void;
  newSession: (mask?: Mask) => void;
  deleteSession: (index: number) => void;
  currentSession: () => ChatSession;
  nextSession: (delta: number) => void;
  onNewMessage: (message: ChatMessage) => void;
  onUserInput: (content: string, extAttr?: any) => Promise<void>;
  summarizeSession: () => void;
  updateStat: (message: ChatMessage) => void;
  updateCurrentSession: (updater: (session: ChatSession) => void) => void;
  updateMessage: (
    sessionIndex: number,
    messageIndex: number,
    updater: (message?: ChatMessage) => void,
  ) => void;
  resetSession: () => void;
  getMessagesWithMemory: () => ChatMessage[];
  getMemoryPrompt: () => ChatMessage;

  clearAllData: () => void;
  fetchMidjourneyStatus: (botMessage: ChatMessage, extAttr?: any) => void;
}

function countMessages(msgs: ChatMessage[]) {
  return msgs.reduce((pre, cur) => pre + estimateTokenLength(cur.content), 0);
}

function fillTemplateWith(input: string, modelConfig: ModelConfig) {
  const vars = {
    model: modelConfig.model,
    time: new Date().toLocaleString(),
    lang: getLang(),
    input: input,
  };

  let output = modelConfig.template ?? DEFAULT_INPUT_TEMPLATE;

  // must contains {{input}}
  const inputVar = "{{input}}";
  if (!output.includes(inputVar)) {
    output += "\n" + inputVar;
  }

  Object.entries(vars).forEach(([name, value]) => {
    output = output.replaceAll(`{{${name}}}`, value);
  });

  return output;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      sessions: [createEmptySession()],
      currentSessionIndex: 0,

      clearSessions() {
        set(() => ({
          sessions: [createEmptySession()],
          currentSessionIndex: 0,
        }));
      },

      selectSession(index: number) {
        set({
          currentSessionIndex: index,
        });
      },

      moveSession(from: number, to: number) {
        set((state) => {
          const { sessions, currentSessionIndex: oldIndex } = state;

          // move the session
          const newSessions = [...sessions];
          const session = newSessions[from];
          newSessions.splice(from, 1);
          newSessions.splice(to, 0, session);

          // modify current session id
          let newIndex = oldIndex === from ? to : oldIndex;
          if (oldIndex > from && oldIndex <= to) {
            newIndex -= 1;
          } else if (oldIndex < from && oldIndex >= to) {
            newIndex += 1;
          }

          return {
            currentSessionIndex: newIndex,
            sessions: newSessions,
          };
        });
      },

      newSession(mask) {
        const session = createEmptySession();

        if (mask) {
          const config = useAppConfig.getState();
          const globalModelConfig = config.modelConfig;

          session.mask = {
            ...mask,
            modelConfig: {
              ...globalModelConfig,
              ...mask.modelConfig,
            },
          };
          session.topic = mask.name;
        }

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [session].concat(state.sessions),
        }));
      },

      nextSession(delta) {
        const n = get().sessions.length;
        const limit = (x: number) => (x + n) % n;
        const i = get().currentSessionIndex;
        get().selectSession(limit(i + delta));
      },

      deleteSession(index) {
        const deletingLastSession = get().sessions.length === 1;
        const deletedSession = get().sessions.at(index);
        if (!deletedSession) return;
        const sessions = get().sessions.slice();
        sessions.splice(index, 1);

        const currentIndex = get().currentSessionIndex;
        let nextIndex = Math.min(
          currentIndex - Number(index < currentIndex),
          sessions.length - 1,
        );

        if (deletingLastSession) {
          nextIndex = 0;
          sessions.push(createEmptySession());
        }

        // for undo delete action
        const restoreState = {
          currentSessionIndex: get().currentSessionIndex,
          sessions: get().sessions.slice(),
        };

        set(() => ({
          currentSessionIndex: nextIndex,
          sessions,
        }));

        showToast(
          Locale.Home.DeleteToast,
          {
            text: Locale.Home.Revert,
            onClick() {
              set(() => restoreState);
            },
          },
          5000,
        );
      },

      currentSession() {
        let index = get().currentSessionIndex;
        const sessions = get().sessions;

        if (index < 0 || index >= sessions.length) {
          index = Math.min(sessions.length - 1, Math.max(0, index));
          set(() => ({ currentSessionIndex: index }));
        }

        const session = sessions[index];

        return session;
      },

      onNewMessage(message) {
        get().updateCurrentSession((session) => {
          session.messages = session.messages.concat();
          session.lastUpdate = Date.now();
        });
        get().updateStat(message);
        get().summarizeSession();
      },

      fetchMidjourneyStatus(botMessage: ChatMessage, extAttr?: any) {
        const taskId = botMessage?.attr?.taskId;
        console.log("请求mj状态------", botMessage, extAttr);
        if (
          !taskId ||
          ["SUCCESS", "FAILURE"].includes(botMessage?.attr?.status) ||
          ChatFetchTaskPool[taskId]
        )
          return;
        console.log("请求mj状态 是否进入------", botMessage, extAttr);
        ChatFetchTaskPool[taskId] = setTimeout(async () => {
          ChatFetchTaskPool[taskId] = null;
          const statusRes = await fetch(
            `/api/midjourney/task/status/${taskId}`,
            {
              method: "GET",
              headers: getHeaders(),
            },
          );
          const statusResJson = await statusRes.json();
          if (statusRes.status < 200 || statusRes.status >= 300) {
            botMessage.content =
              Locale.Midjourney.TaskStatusFetchFail +
                ": " +
                (statusResJson?.error || statusResJson?.description) ||
              Locale.Midjourney.UnknownReason;
          } else {
            let isFinished = false;
            let content;
            const prefixContent = Locale.Midjourney.TaskPrefix(
              statusResJson.prompt,
              taskId,
            );
            switch (statusResJson?.status) {
              case "SUCCESS":
                content = statusResJson.uri;
                isFinished = true;
                if (statusResJson.uri) {
                  let imgUrl = useGetMidjourneySelfProxyUrl(statusResJson.uri);
                  botMessage.attr.imgUrl = imgUrl;
                  botMessage.content =
                    prefixContent + `[![${taskId}](${imgUrl})](${imgUrl})`;
                }
                if (
                  statusResJson.action === "DESCRIBE" &&
                  statusResJson.prompt
                ) {
                  botMessage.content = statusResJson.prompt;
                }
                botMessage.attr.options = statusResJson.options;
                botMessage.attr.msgId = statusResJson.msgId;
                botMessage.attr.flags = statusResJson.flags;
                botMessage.attr.msgHash = statusResJson.msgHash;
                break;
              case "FAIL":
                content = statusResJson.msg || Locale.Midjourney.UnknownReason;
                isFinished = true;
                botMessage.content =
                  prefixContent +
                  `**${
                    Locale.Midjourney.TaskStatus
                  }:** [${new Date().toLocaleString()}] - ${content}`;
                break;
              case "WAIT":
                content = Locale.Midjourney.TaskNotStart;
                break;
              case "PROGRESS":
                content = Locale.Midjourney.TaskProgressTip(
                  statusResJson.progress,
                );
                break;
              case "SUBMITTED":
                content = Locale.Midjourney.TaskRemoteSubmit;
                break;
              default:
                content = statusResJson.status;
            }
            botMessage.attr.status = statusResJson.status;
            if (isFinished) {
              botMessage.attr.finished = true;
            } else {
              botMessage.content =
                prefixContent +
                `**${
                  Locale.Midjourney.TaskStatus
                }:** [${new Date().toLocaleString()}] - ${content}`;
              if (statusResJson.status === "PROGRESS" && statusResJson.uri) {
                let imgUrl = useGetMidjourneySelfProxyUrl(statusResJson.uri);
                botMessage.attr.imgUrl = imgUrl;
                botMessage.content += `\n[![${taskId}](${imgUrl})](${imgUrl})`;
              }
              this.fetchMidjourneyStatus(botMessage, extAttr);
            }
            set(() => ({}));
            if (isFinished) {
              extAttr?.setAutoScroll(true);
            }
          }
        }, 3000);
      },
      //发放请求

      async onUserInput(content, extAttr?: any) {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;
        if (
          extAttr?.mjImageMode &&
          (extAttr?.useImages?.length ?? 0) > 0 &&
          extAttr.mjImageMode !== "IMAGINE"
        ) {
          if (
            extAttr.mjImageMode === "BLEND" &&
            (extAttr.useImages.length < 2 || extAttr.useImages.length > 5)
          ) {
            alert(Locale.Midjourney.BlendMinImg(2, 5));
            return new Promise((resolve: any, reject) => {
              resolve(false);
            });
          }
          content = `/mj ${extAttr?.mjImageMode}`;
          extAttr.useImages.forEach((img: any, index: number) => {
            content += `::[${index + 1}]${img.filename}`;
          });
        }

        const userContent = fillTemplateWith(content, modelConfig);
        const userMessage: ChatMessage = createMessage({
          role: "user",
          content: userContent,
        });

        const botMessage: ChatMessage = createMessage({
          role: "assistant",
          streaming: true,
          model: modelConfig.model,
          attr: {},
        });

        // get recent messages
        const recentMessages = get().getMessagesWithMemory();
        const sendMessages = recentMessages.concat(userMessage);
        const sessionId = get().currentSession().id;
        const messageIndex = get().currentSession().messages.length + 1;

        // save user's and bot's message
        get().updateCurrentSession((session) => {
          const savedUserMessage = {
            ...userMessage,
            content,
          };
          session.messages = session.messages.concat([
            savedUserMessage,
            botMessage,
          ]);
        });

        if (
          content.toLowerCase().startsWith("/mj") ||
          content.toLowerCase().startsWith("/MJ")
        ) {
          botMessage.model = "midjourney";
          const startFn = async () => {
              const prompt = content.substring(3).trim();
              let action: string = "IMAGINE";
              console.log(action);
              const firstSplitIndex = prompt.indexOf("::");
              if (firstSplitIndex > 0) {
                  action = prompt.substring(0, firstSplitIndex);
              }
              if (
                  ![
                      "CUSTOM",
                      "IMAGINE",
                      "DESCRIBE",
                      "BLEND",
                  ].includes(action)
              ) {
                  botMessage.content = Locale.Midjourney.TaskErrUnknownType;
                  botMessage.streaming = false;
                  return;
              }
              botMessage.attr.action = action;
              let actionIndex: any = null;
              let actionUseTaskId: any = null;
              let cmd: any = null;
              if (action === "CUSTOM") {
                  const s = prompt.substring(firstSplitIndex + 2)
                  const nextIndex = s.indexOf("::");
                  actionUseTaskId = s.substring(0, nextIndex)
                  cmd = s.substring(nextIndex + 2);
              }
              try {
                  const imageBase64s =
                      extAttr?.useImages?.map((ui: any) => ui.base64) || [];
                  const res = await fetch("/api/midjourney/task/submit", {
                      method: "POST",
                      headers: getHeaders(),
                      body: JSON.stringify({
                          prompt: prompt,
                          images: imageBase64s,
                          action: action,
                          cmd: cmd,
                          index: actionIndex,
                          taskId: actionUseTaskId,
                          msgId: extAttr?.botMsg?.msgId,
                          flags: extAttr?.botMsg?.flags,
                          msgHash: extAttr?.botMsg?.msgHash,
                      }),
                  });
                  if (res == null) {
                      botMessage.content =
                          Locale.Midjourney.TaskErrNotSupportType(action);
                      botMessage.streaming = false;
                      return;
                  }
                  if (!res.ok) {
                      const text = await res.text();
                      botMessage.content = res.status === 401 ? `${Locale.Error.Unauthorized}\n\`\`\`json\n${text}\n\`\`\`\n` : Locale.Midjourney.TaskSubmitErr(
                          text || Locale.Midjourney.UnknownError,
                      );
                  } else {
                      const resJson = await res.json();
                      if(resJson.status=='FAIL' || resJson.code!==0){
                          botMessage.content = Locale.Midjourney.TaskSubmitErr(
                              resJson.msg || resJson.error || Locale.Midjourney.UnknownError,
                          );
                      }else{
                          const taskId: string = resJson.taskId;
                          const prefixContent = Locale.Midjourney.TaskPrefix(
                              prompt,
                              taskId,
                          );
                          botMessage.content =
                              prefixContent +
                              `[${new Date().toLocaleString()}] - ${
                                  Locale.Midjourney.TaskSubmitOk
                              }: ` + Locale.Midjourney.PleaseWait;
                          botMessage.attr.taskId = taskId;
                          botMessage.attr.status = resJson.status;
                          this.fetchMidjourneyStatus(botMessage, extAttr);
                      }
                  }
              } catch (e: any) {
                  console.error(e);
                  botMessage.content = Locale.Midjourney.TaskSubmitErr(
                      e?.error || e?.message || Locale.Midjourney.UnknownError,
                  );
              } finally {
                  ChatControllerPool.remove(
                      sessionId,
                      botMessage.id ?? messageIndex,
                  );
                  botMessage.streaming = false;
              }
          };
          await startFn();
          get().onNewMessage(botMessage);
          set(() => ({}));
          extAttr?.setAutoScroll(true);
        } else if (
          content
            .toLowerCase()
            .startsWith("/hi" || content.toLowerCase().startsWith("/Hi"))
        ) {
          {
            const appConfig = useAppConfig.getState();
            const api = useAccessStore.getState();
            const generateVideo = async () => {
              const response = await fetch("/api/generateVideo", {
                method: "POST",
                body: JSON.stringify({
                  video_inputs: [
                    {
                      character: {
                        type: "avatar",
                        avatar_id:
                          appConfig.personModel === personModel.FemaleModel
                            ? "Angela-inwhiteskirt-20220820"
                            : "Joon-incasualsuit-20220821",
                        avatar_style: "normal",
                        // type: "talking_photo",
                        // talking_photo_id: "ba9c11684315405aac1dd8ed987fdda2"
                      },
                      voice: {
                        type: "text",
                        input_text: content.substring(3).trim(),
                        voice_id:
                          appConfig.voiceCheck === voiceCheck.Male
                            ? "961546a1be64458caa1386ff63dd5d5f"
                            : "8a44173a27984487b3fa86e56004218c",
                      },
                      background: {
                        type:
                          appConfig.checkFlag === checkFlag.Auto
                            ? "color"
                            : appConfig.checkFlag === checkFlag.First
                            ? "image"
                            : "video",
                        value:
                          appConfig.checkFlag === checkFlag.Auto
                            ? appConfig.backColor.toString()
                            : "",
                        url:
                          appConfig.checkFlag === checkFlag.First
                            ? appConfig.backImg
                            : appConfig.checkFlag === checkFlag.Second
                            ? "https://www.dazanim.com/hi.mp4"
                            : "",
                        play_style:
                          appConfig.checkFlag === checkFlag.Second
                            ? "loop"
                            : "",
                      },
                    },
                  ],
                  test: false,
                  aspect_ratio: "16:9",
                  token: api.heygenToken,
                  // caption: appConfig.autoTitleGeneration,
                }),
              });
              const res = await response.json();
              const handleError = (data: string) => {
                botMessage.streaming = false;
                botMessage.content = data;
                get().onNewMessage(botMessage);
              };
              if (res.error === null) {
                async function checkVideoStatus() {
                  const response = await fetch(`/api/videoStatus`, {
                    method: "POST",
                    body: JSON.stringify({
                      video_id: res.data.video_id,
                      token: api.heygenToken,
                    }),
                  });
                  const data = await response.json();
                  const { status, video_url_caption, video_url, error } =
                    data.data;
                  if (status !== "failed") {
                    if (status === "processing" || status === "waiting") {
                      setTimeout(checkVideoStatus, 2000);
                    } else if (status === "completed") {
                      const url =
                        video_url_caption === null
                          ? video_url
                          : video_url_caption;
                      handleError(url);
                    }
                  } else {
                    handleError(error.message);
                  }
                }

                checkVideoStatus();
              } else {
                handleError(res.error.message);
              }
            };

            generateVideo();
          }
        } else {
          // make request
          api.llm.chat({
            messages: sendMessages,
            config: { ...modelConfig, stream: true },
            onUpdate(message) {
              botMessage.streaming = true;
              if (message) {
                botMessage.content = message;
              }
              get().updateCurrentSession((session) => {
                session.messages = session.messages.concat();
              });
            },
            onFinish(message) {
              botMessage.streaming = false;
              if (message) {
                botMessage.content = message;
                get().onNewMessage(botMessage);
              }
              ChatControllerPool.remove(session.id, botMessage.id);
            },
            onError(error) {
              const isAborted = error.message.includes("aborted");
              botMessage.content +=
                "\n\n" +
                prettyObject({
                  error: true,
                  message: error.message,
                });
              botMessage.streaming = false;
              userMessage.isError = !isAborted;
              botMessage.isError = !isAborted;
              get().updateCurrentSession((session) => {
                session.messages = session.messages.concat();
              });
              ChatControllerPool.remove(
                session.id,
                botMessage.id ?? messageIndex,
              );
              console.error("[Chat] failed ", error);
            },
            onController(controller) {
              // collect controller for stop/retry
              ChatControllerPool.addController(
                session.id,
                botMessage.id ?? messageIndex,
                controller,
              );
            },
          });
        }
      },

      getMemoryPrompt() {
        const session = get().currentSession();

        return {
          role: "system",
          content:
            session.memoryPrompt.length > 0
              ? Locale.Store.Prompt.History(session.memoryPrompt)
              : "",
          date: "",
        } as ChatMessage;
      },

      getMessagesWithMemory() {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;
        const clearContextIndex = session.clearContextIndex ?? 0;
        const messages = session.messages.slice();
        const totalMessageCount = session.messages.length;

        // in-context prompts
        const contextPrompts = session.mask.context.slice();

        // system prompts, to get close to OpenAI Web ChatGPT
        const shouldInjectSystemPrompts = modelConfig.enableInjectSystemPrompts;
        const systemPrompts = shouldInjectSystemPrompts
          ? [
              createMessage({
                role: "system",
                content: fillTemplateWith("", {
                  ...modelConfig,
                  template: DEFAULT_SYSTEM_TEMPLATE,
                }),
              }),
            ]
          : [];
        if (shouldInjectSystemPrompts) {
          console.log(
            "[Global System Prompt] ",
            systemPrompts.at(0)?.content ?? "empty",
          );
        }

        // long term memory
        const shouldSendLongTermMemory =
          modelConfig.sendMemory &&
          session.memoryPrompt &&
          session.memoryPrompt.length > 0 &&
          session.lastSummarizeIndex > clearContextIndex;
        const longTermMemoryPrompts = shouldSendLongTermMemory
          ? [get().getMemoryPrompt()]
          : [];
        const longTermMemoryStartIndex = session.lastSummarizeIndex;

        // short term memory
        const shortTermMemoryStartIndex = Math.max(
          0,
          totalMessageCount - modelConfig.historyMessageCount,
        );

        // lets concat send messages, including 4 parts:
        // 0. system prompt: to get close to OpenAI Web ChatGPT
        // 1. long term memory: summarized memory messages
        // 2. pre-defined in-context prompts
        // 3. short term memory: latest n messages
        // 4. newest input message
        const memoryStartIndex = shouldSendLongTermMemory
          ? Math.min(longTermMemoryStartIndex, shortTermMemoryStartIndex)
          : shortTermMemoryStartIndex;
        // and if user has cleared history messages, we should exclude the memory too.
        const contextStartIndex = Math.max(clearContextIndex, memoryStartIndex);
        const maxTokenThreshold = modelConfig.max_tokens;

        // get recent messages as much as possible
        const reversedRecentMessages = [];
        for (
          let i = totalMessageCount - 1, tokenCount = 0;
          i >= contextStartIndex && tokenCount < maxTokenThreshold;
          i -= 1
        ) {
          const msg = messages[i];
          if (!msg || msg.isError) continue;
          tokenCount += estimateTokenLength(msg.content);
          reversedRecentMessages.push(msg);
        }

        // concat all messages
        const recentMessages = [
          ...systemPrompts,
          ...longTermMemoryPrompts,
          ...contextPrompts,
          ...reversedRecentMessages.reverse(),
        ];

        return recentMessages;
      },

      updateMessage(
        sessionIndex: number,
        messageIndex: number,
        updater: (message?: ChatMessage) => void,
      ) {
        const sessions = get().sessions;
        const session = sessions.at(sessionIndex);
        const messages = session?.messages;
        updater(messages?.at(messageIndex));
        set(() => ({ sessions }));
      },

      resetSession() {
        get().updateCurrentSession((session) => {
          session.messages = [];
          session.memoryPrompt = "";
        });
      },

      summarizeSession() {
        const config = useAppConfig.getState();
        const session = get().currentSession();

        // remove error messages if any
        const messages = session.messages;

        // should summarize topic after chating more than 50 words
        const SUMMARIZE_MIN_LEN = 50;
        if (
          config.enableAutoGenerateTitle &&
          session.topic === DEFAULT_TOPIC &&
          countMessages(messages) >= SUMMARIZE_MIN_LEN
        ) {
          const topicMessages = messages.concat(
            createMessage({
              role: "user",
              content: Locale.Store.Prompt.Topic,
            }),
          );
          api.llm.chat({
            messages: topicMessages,
            config: {
              model: "gpt-3.5-turbo",
            },
            onFinish(message) {
              get().updateCurrentSession(
                (session) =>
                  (session.topic =
                    message.length > 0 ? trimTopic(message) : DEFAULT_TOPIC),
              );
            },
          });
        }

        const modelConfig = session.mask.modelConfig;
        const summarizeIndex = Math.max(
          session.lastSummarizeIndex,
          session.clearContextIndex ?? 0,
        );
        let toBeSummarizedMsgs = messages
          .filter((msg) => !msg.isError)
          .slice(summarizeIndex);

        const historyMsgLength = countMessages(toBeSummarizedMsgs);

        if (historyMsgLength > modelConfig?.max_tokens ?? 4000) {
          const n = toBeSummarizedMsgs.length;
          toBeSummarizedMsgs = toBeSummarizedMsgs.slice(
            Math.max(0, n - modelConfig.historyMessageCount),
          );
        }

        // add memory prompt
        toBeSummarizedMsgs.unshift(get().getMemoryPrompt());

        const lastSummarizeIndex = session.messages.length;

        console.log(
          "[Chat History] ",
          toBeSummarizedMsgs,
          historyMsgLength,
          modelConfig.compressMessageLengthThreshold,
        );

        if (
          historyMsgLength > modelConfig.compressMessageLengthThreshold &&
          modelConfig.sendMemory
        ) {
          api.llm.chat({
            messages: toBeSummarizedMsgs.concat(
              createMessage({
                role: "system",
                content: Locale.Store.Prompt.Summarize,
                date: "",
              }),
            ),
            config: { ...modelConfig, stream: true, model: "gpt-3.5-turbo" },
            onUpdate(message) {
              session.memoryPrompt = message;
            },
            onFinish(message) {
              console.log("[Memory] ", message);
              session.lastSummarizeIndex = lastSummarizeIndex;
            },
            onError(err) {
              console.error("[Summarize] ", err);
            },
          });
        }
      },

      updateStat(message) {
        get().updateCurrentSession((session) => {
          session.stat.charCount += message.content.length;
          // TODO: should update chat count and word count
        });
      },

      updateCurrentSession(updater) {
        const sessions = get().sessions;
        const index = get().currentSessionIndex;
        updater(sessions[index]);
        set(() => ({ sessions }));
      },

      clearAllData() {
        localStorage.clear();
        location.reload();
      },
    }),
    {
      name: StoreKey.Chat,
      version: 3.1,
      migrate(persistedState, version) {
        const state = persistedState as any;
        const newState = JSON.parse(JSON.stringify(state)) as ChatStore;

        if (version < 2) {
          newState.sessions = [];

          const oldSessions = state.sessions;
          for (const oldSession of oldSessions) {
            const newSession = createEmptySession();
            newSession.topic = oldSession.topic;
            newSession.messages = [...oldSession.messages];
            newSession.mask.modelConfig.sendMemory = true;
            newSession.mask.modelConfig.historyMessageCount = 4;
            newSession.mask.modelConfig.compressMessageLengthThreshold = 1000;
            newState.sessions.push(newSession);
          }
        }

        if (version < 3) {
          // migrate id to nanoid
          newState.sessions.forEach((s) => {
            s.id = nanoid();
            s.messages.forEach((m) => (m.id = nanoid()));
          });
        }

        // Enable `enableInjectSystemPrompts` attribute for old sessions.
        // Resolve issue of old sessions not automatically enabling.
        if (version < 3.1) {
          newState.sessions.forEach((s) => {
            if (
              // Exclude those already set by user
              !s.mask.modelConfig.hasOwnProperty("enableInjectSystemPrompts")
            ) {
              // Because users may have changed this configuration,
              // the user's current configuration is used instead of the default
              const config = useAppConfig.getState();
              s.mask.modelConfig.enableInjectSystemPrompts =
                config.modelConfig.enableInjectSystemPrompts;
            }
          });
        }

        return newState;
      },
    },
  ),
);
