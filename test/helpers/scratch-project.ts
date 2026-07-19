import { ZipFile } from 'yazl';

export async function createScratchProjectBuffer(options: { withStage?: boolean; label?: string } = {}) {
  const zip = new ZipFile();
  const project = {
    targets: options.withStage === false ? [] : [{ isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null }],
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: 'test', agent: options.label || 'integration-test' },
  };
  zip.addBuffer(Buffer.from(JSON.stringify(project)), 'project.json');
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
