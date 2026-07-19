import { validateScratchProject } from '../../src/modules/scratch/scratch-project.validator';
import { createScratchProjectBuffer } from '../helpers/scratch-project';

describe('Scratch project validator', () => {
  it('accepts a real Scratch 3 archive and reports structural facts', async () => {
    const project = await createScratchProjectBuffer();
    await expect(validateScratchProject(project, '课堂作品.sb3')).resolves.toMatchObject({
      hasStage: true,
      targetCount: 1,
      spriteCount: 0,
    });
  });

  it('rejects renamed content, wrong extensions and projects without a stage', async () => {
    await expect(validateScratchProject(Buffer.from('not-a-zip'), 'fake.sb3')).rejects.toThrow('合法的 .sb3');
    await expect(validateScratchProject(await createScratchProjectBuffer(), 'project.zip')).rejects.toThrow('.sb3');
    await expect(validateScratchProject(await createScratchProjectBuffer({ withStage: false }), 'empty.sb3'))
      .rejects.toThrow('有效舞台');
  });
});
