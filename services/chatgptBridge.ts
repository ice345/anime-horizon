import { genresByStance, TasteModel } from '../features/taste/tasteModel';
import { promptTitleOf } from './archivePrompt';

const fallbackCopy = (text: string) => {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand('copy');
  textArea.remove();
  if (!copied) throw new Error('Copy command was rejected');
};

export const copyBridgePrompt = async (text: string) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  fallbackCopy(text);
};

export const openChatGPT = () => {
  window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
};

const joinOr = (items: string[], fallback: string) => items.join('、') || fallback;

/**
 * Image prompt for the all-time portrait. It is built only from what the user actually said and
 * watched: favorite works (with notes), genres with positive reactions, and descriptive viewing
 * range. Plan-to-watch titles, unrated titles and identity labels are deliberately left out.
 */
export const buildPortraitImagePrompt = (model: TasteModel) => {
  const favorites = model.favorites.map((anime) => {
    const note = anime.userNote?.trim() ? `（短评：${anime.userNote.trim().slice(0, 120)}）` : '';
    return `${promptTitleOf(anime)}${note}`;
  });
  const positive = genresByStance(model).positive.map((genre) => genre.key);
  const explored = model.genres.slice(0, 5).map((genre) => genre.key);
  const decades = model.eras.map((era) => `${era.key}年代`);

  return `请直接生成一张竖版 3:4 的“动画口味画像”插画，不要先解释。画面不需要出现人物肖像或任何已有动画角色，也不要出现文字、Logo、标题、水印。

画面要求：浅蓝天空、透明水彩质感、风中羽毛、细淡的五线谱；情绪安静、克制。以色彩、构图与象征物表现观影口味，避免拼贴海报和具体版权角色。

只根据下面这些用户真实记录来构思，不要使用任何身份标签、等级、分数或刻板印象，也不要把用户画成某种人格类型：
- 用户明确喜欢的作品：${joinOr(favorites, '暂无')}
- 用户明确喜欢的题材（基于至少 3 部有感受记录的作品）：${joinOr(positive, '暂无足够证据')}
- 看得较多的题材（只代表看过，不代表喜欢）：${joinOr(explored, '暂无')}
- 看过的作品来自：${joinOr(decades, '暂无')}
共看过 ${model.totals.watched} 部，其中 ${model.totals.positive} 部标记为喜欢或非常喜欢。

请让画面体现这些作品与题材的共同气质，而不是模仿某一部作品；不要生成任何可识别的版权角色。

请只生成图像。`;
};
