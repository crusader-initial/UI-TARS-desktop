/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import OpenAI, { type ClientOptions } from 'openai';
import {
  type ChatCompletionCreateParamsBase,
  type ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { actionParser } from '@ui-tars/action-parser';

import { useContext } from './context/useContext';
import { Model, type InvokeParams, type InvokeOutput } from './types';

import { preprocessResizeImage, convertToOpenAIMessages } from './utils';
import { DEFAULT_FACTORS, MAX_PIXELS } from './constants';

type OpenAIChatCompletionCreateParams = Omit<ClientOptions, 'maxRetries'> &
  Pick<
    ChatCompletionCreateParamsBase,
    'model' | 'max_tokens' | 'temperature' | 'top_p'
  >;

export interface UITarsModelConfig extends OpenAIChatCompletionCreateParams {}

export class UITarsModel extends Model {
  constructor(protected readonly modelConfig: UITarsModelConfig) {
    super();
    this.modelConfig = modelConfig;
  }

  /** [widthFactor, heightFactor] */
  get factors(): [number, number] {
    return DEFAULT_FACTORS;
  }

  get modelName(): string {
    return this.modelConfig.model ?? 'unknown';
  }

  /**
   * call real LLM / VLM Model
   * @param params
   * @param options
   * @returns
   */
  protected async invokeModelProvider(
    params: {
      messages: Array<ChatCompletionMessageParam>;
    },
    options: {
      signal?: AbortSignal;
    },
  ): Promise<{
    prediction: string;
  }> {
    const { messages } = params;
    const {
      baseURL,
      apiKey,
      model,
      max_tokens = 1000,
      temperature = 0,
      top_p = 0.7,
      ...restOptions
    } = this.modelConfig;

    // 打印完整的请求参数
    const { logger } = useContext();
    logger?.info(
      '[UITarsModel Request]:',
      JSON.stringify({
        model,
        messages: messages.map((msg) => ({
          role: msg.role,
          content:
            typeof msg.content === 'string'
              ? msg.content
              : Array.isArray(msg.content)
                ? msg.content.map((item) =>
                    item.type === 'text'
                      ? {
                          type: 'text',
                          text: item.text,
                        }
                      : {
                          type: 'image_url',
                          image_url: { url: '...(image data truncated)' },
                        },
                  )
                : msg.content,
        })),
        max_tokens,
        temperature,
        top_p,
      }),
    );

    const openai = new OpenAI({
      ...restOptions,
      maxRetries: 0,
      baseURL,
      apiKey,
    });

    const result = await openai.chat.completions.create(
      {
        model,
        messages,
        stream: false,
        seed: null,
        stop: null,
        frequency_penalty: null,
        presence_penalty: null,
        // custom options
        max_tokens,
        temperature,
        top_p,
      },
      options,
    );

    return {
      prediction: result.choices?.[0]?.message?.content ?? '',
    };
  }

  async invoke(params: InvokeParams): Promise<InvokeOutput> {
    const { conversations, images, screenContext, scaleFactor } = params;
    const { logger, signal } = useContext();

    // const compressedImages = await Promise.all(
    //   images.map((image) => preprocessResizeImage(image, MAX_PIXELS)),
    // );

    const messages = convertToOpenAIMessages({
      conversations,
      // images: compressedImages,
      images,
    });

    const startTime = Date.now();
    const result = await this.invokeModelProvider(
      {
        messages,
      },
      {
        signal,
      },
    )
      .catch((e) => {
        logger?.error('[UITarsModel] error', e);
        throw e;
      })
      .finally(() => {
        logger?.info(`[UITarsModel cost]: ${Date.now() - startTime}ms`);
      });

    // 添加这行来打印原始预测结果
    logger?.info(`[UITarsModel raw prediction]: ${JSON.stringify(result)}`);

    if (!result.prediction) {
      const err = new Error();
      err.name = 'vlm response error';
      err.stack = JSON.stringify(result) ?? 'no message';
      logger?.error(err);
      throw err;
    }

    const { prediction } = result;

    try {
      // 记录屏幕上下文信息
      logger?.info(
        `[UITarsModel screen context]: width=${screenContext?.width}, height=${screenContext?.height}`,
      );
      const { parsed: parsedPredictions } = await actionParser({
        prediction,
        factor: this.factors,
        screenContext,
        scaleFactor,
      });
      // 添加这行来打印解析后的预测结果和使用的缩放因子
      // 添加更详细的日志
      logger?.info(
        `[UITarsModel parsed predictions]: ${JSON.stringify(parsedPredictions)}, factors: ${JSON.stringify(this.factors)}, scaleFactor: ${scaleFactor}`,
      );

      // 如果是点击操作，计算并显示边界框中心点
      if (
        parsedPredictions.length > 0 &&
        parsedPredictions[0].action_type === 'click'
      ) {
        // if (parsedPredictions[0].action_inputs?.start_coords) {
        //   if (
        //     Array.isArray(parsedPredictions[0].action_inputs.start_coords) &&
        //     parsedPredictions[0].action_inputs.start_coords.length === 2
        //   ) {
        //     // 纵坐标+10像素
        //     parsedPredictions[0].action_inputs.start_coords[0] =
        //       parsedPredictions[0].action_inputs.start_coords[0] + 15;

        //     parsedPredictions[0].action_inputs.start_coords[1] =
        //       parsedPredictions[0].action_inputs.start_coords[1] + 15;

        //     logger?.info(`[UITarsModel] 已对点击坐标进行微调，纵坐标+10像素`);
        //   }
        // }
        // 计算并显示边界框中心点
        const box = parsedPredictions[0].action_inputs?.start_box;
        if (box && typeof box === 'string') {
          try {
            const [x1, y1, x2, y2] = JSON.parse(box.replace(/[\[\]]/g, ''));
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            // 使用中心点作为点击坐标，并进行微调
            // if (parsedPredictions[0].action_inputs?.start_coords) {
            //   parsedPredictions[0].action_inputs.start_coords = [
            //     centerX + 15, // 横坐标+15像素
            //     centerY + 15, // 纵坐标+15像素
            //   ];

            //   logger?.info(
            //     `[UITarsModel] 已使用边界框中心点作为点击坐标，并进行微调 +15px`,
            //   );
            // }

            logger?.info(
              `[UITarsModel box center]: [${centerX}, ${centerY}], actual click: ${JSON.stringify(parsedPredictions[0].action_inputs?.start_coords)}`,
            );
          } catch (e) {
            logger?.error(`[UITarsModel] Failed to parse box: ${box}`);
          }
        }
      }
      return {
        prediction,
        parsedPredictions,
      };
    } catch (error) {
      logger?.error('[UITarsModel] error', error);
      return {
        prediction,
        parsedPredictions: [],
      };
    }
  }
}
