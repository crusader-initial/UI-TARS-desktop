/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'assert';

import { logger } from '@main/logger';
import { hideWindowBlock } from '@main/window/index';
import { StatusEnum } from '@ui-tars/shared/types';
import { type ConversationWithSoM } from '@main/shared/types';
import { GUIAgent, type GUIAgentConfig } from '@ui-tars/sdk';
import { markClickPosition } from '@main/utils/image';
import { UTIOService } from '@main/services/utio';
import { NutJSElectronOperator } from '../agent/operator';
import { AdbElectronOperator } from '../agent/operator';
import { getSystemPrompt } from '../agent/prompts';
import {
  closeScreenMarker,
  hidePauseButton,
  hideScreenWaterFlow,
  showPauseButton,
  showPredictionMarker,
  showScreenWaterFlow,
} from '@main/window/ScreenMarker';
import { SettingStore } from '@main/store/setting';
import { AppState, OperatorType } from '@main/store/types';

export const runAgent = async (
  setState: (state: AppState) => void,
  getState: () => AppState,
) => {
  logger.info('runAgent');
  const settings = SettingStore.getStore();
  const { instructions, abortController } = getState();
  assert(instructions, 'instructions is required');

  const language = settings.language ?? 'en';

  showPauseButton();
  showScreenWaterFlow();

  // 从设置中获取 deviceId，如果没有则设为 null
  let deviceId = settings.androidDeviceId || '';

  const handleData: GUIAgentConfig<
    NutJSElectronOperator | AdbElectronOperator
  >['onData'] = async ({ data }) => {
    const lastConv = getState().messages[getState().messages.length - 1];
    const { status, conversations, ...restUserData } = data;
    logger.info('[status]', status, conversations.length);

    // add SoM to conversations
    const conversationsWithSoM: ConversationWithSoM[] = await Promise.all(
      conversations.map(async (conv) => {
        const { screenshotContext, predictionParsed } = conv;
        if (
          lastConv?.screenshotBase64 &&
          screenshotContext?.size &&
          predictionParsed
        ) {
          const screenshotBase64WithElementMarker = await markClickPosition({
            screenshotContext,
            base64: lastConv?.screenshotBase64,
            parsed: predictionParsed,
          }).catch((e) => {
            logger.error('[markClickPosition error]:', e);
            return '';
          });
          return {
            ...conv,
            screenshotBase64WithElementMarker,
          };
        }
        return conv;
      }),
    ).catch((e) => {
      logger.error('[conversationsWithSoM error]:', e);
      return conversations;
    });

    const {
      screenshotBase64,
      predictionParsed,
      screenshotContext,
      screenshotBase64WithElementMarker,
      ...rest
    } = conversationsWithSoM?.[conversationsWithSoM.length - 1] || {};
    logger.info(
      '======data======\n',
      predictionParsed,
      screenshotContext,
      rest,
      status,
      '\n========',
    );

    if (
      predictionParsed?.length &&
      screenshotContext?.size &&
      !abortController?.signal?.aborted
    ) {
      showPredictionMarker(predictionParsed, screenshotContext);
    }

    setState({
      ...getState(),
      status,
      restUserData,
      messages: [...(getState().messages || []), ...conversationsWithSoM],
    });
  };

  // 如果没有预先配置的设备 ID，可以尝试自动获取
  if (!deviceId && settings.operatorType === OperatorType.ADB) {
    try {
      // 从 AdbOperator 导入 getAndroidDeviceId 函数
      const { getAndroidDeviceId } = await import('@ui-tars/operator-adb');
      deviceId = await getAndroidDeviceId();

      if (!deviceId) {
        logger.error('[runAgent] No Android device found');
        setState({
          ...getState(),
          status: StatusEnum.ERROR,
          errorMsg: '未找到 Android 设备，请确保设备已连接并启用 USB 调试',
        });
        return;
      }
    } catch (error) {
      logger.error('[runAgent] Failed to get Android device ID', error);
      setState({
        ...getState(),
        status: StatusEnum.ERROR,
        errorMsg: '获取 Android 设备 ID 失败',
      });
      return;
    }
  }

  const guiAgent = new GUIAgent({
    model: {
      baseURL: settings.vlmBaseUrl,
      apiKey: settings.vlmApiKey,
      model: settings.vlmModelName,
    },
    systemPrompt: getSystemPrompt(language),
    logger,
    signal: abortController?.signal,
    // 根据设置选择使用哪个 operator
    operator:
      settings.operatorType === OperatorType.ADB
        ? new AdbElectronOperator(deviceId)
        : new NutJSElectronOperator(),
    onData: handleData,
    onError: ({ error }) => {
      logger.error('[runAgent error]', settings, error);
    },
    retry: {
      model: {
        maxRetries: 3,
      },
      screenshot: {
        maxRetries: 5,
      },
      execute: {
        maxRetries: 1,
      },
    },
  });

  await hideWindowBlock(async () => {
    await UTIOService.getInstance().sendInstruction(instructions);

    await guiAgent
      .run(instructions)
      .catch((e) => {
        logger.error('[runAgentLoop error]', e);
        setState({
          ...getState(),
          status: StatusEnum.ERROR,
          errorMsg: e.message,
        });
      })
      .finally(() => {
        closeScreenMarker();
        hidePauseButton();
        hideScreenWaterFlow();
      });
  }).catch((e) => {
    logger.error('[runAgent error hideWindowBlock]', settings, e);
  });
};
