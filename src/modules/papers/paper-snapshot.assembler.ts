import { BadRequestException, Injectable } from '@nestjs/common';
import { UpdatePaperQuestionSnapshotDto } from './dto/update-paper-question-snapshot.dto';

type SnapshotObject = Record<string, unknown>;
type SnapshotOptionObject = SnapshotObject & {
  id?: string;
  optionKey?: string;
  content?: string;
  isCorrect?: boolean;
  sortOrder?: number;
};

@Injectable()
export class PaperSnapshotAssembler {
  mergeQuestionSnapshot(snapshot: SnapshotObject, dto: UpdatePaperQuestionSnapshotDto) {
      const hasPatch =
        dto.title !== undefined ||
        dto.content !== undefined ||
        dto.analysis !== undefined ||
        dto.options !== undefined;

      if (!hasPatch) {
        throw new BadRequestException('没有可更新的显示内容');
      }

      const next: SnapshotObject = { ...snapshot };

      if (dto.title !== undefined) {
        const title = dto.title.trim();
        if (!title) {
          throw new BadRequestException('题目标题不能为空');
        }
        next.title = title;
      }

      if (dto.content !== undefined) {
        const content = dto.content.trim();
        if (!content) {
          throw new BadRequestException('题干内容不能为空');
        }
        next.content = content;
      }

      if (dto.analysis !== undefined) {
        next.analysis = dto.analysis.trim();
      }

      if (dto.options !== undefined) {
        next.options = this.mergeSnapshotOptions(snapshot.options, dto.options);
      }

      return next;
    }

  mergeSnapshotOptions(
      currentOptionsValue: unknown,
      optionPatches: NonNullable<UpdatePaperQuestionSnapshotDto['options']>,
    ) {
      if (!Array.isArray(currentOptionsValue)) {
        throw new BadRequestException('当前题型没有可编辑的选项');
      }

      if (optionPatches.length !== currentOptionsValue.length) {
        throw new BadRequestException('试卷显示编辑只允许修改现有选项，不能增删选项');
      }

      const currentOptions = currentOptionsValue.map((option) =>
        this.toSnapshotObject(option),
      ) as SnapshotOptionObject[];
      const currentById = new Map(
        currentOptions
          .filter((option) => typeof option.id === 'string' && option.id)
          .map((option) => [option.id as string, option]),
      );
      const usedKeys = new Set<string>();

      const nextOptions = optionPatches.map((patch, index) => {
        const current = patch.id ? currentById.get(patch.id) : currentOptions[index];
        if (!current) {
          throw new BadRequestException(`第 ${index + 1} 个选项不存在，无法更新`);
        }

        const key = current.id ?? `index-${index}`;
        if (usedKeys.has(key)) {
          throw new BadRequestException('选项不能重复提交');
        }
        usedKeys.add(key);

        const content = patch.content.trim();
        if (!content) {
          throw new BadRequestException(`第 ${index + 1} 个选项内容不能为空`);
        }

        const optionKey = patch.optionKey?.trim() || current.optionKey || String.fromCharCode(65 + index);

        return {
          ...current,
          optionKey,
          content,
          sortOrder: patch.sortOrder ?? index + 1,
        };
      });

      if (usedKeys.size !== currentOptions.length) {
        throw new BadRequestException('选项提交不完整，无法更新');
      }

      return nextOptions;
    }

  toSnapshotObject(value: unknown): SnapshotObject {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
      }

      return { ...(value as SnapshotObject) };
    }
}
