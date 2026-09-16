import { PromptsService } from './prompts.service';

describe('PromptsService episode decision points', () => {
  const prompts = new PromptsService();

  it('requires episode content to stop before the active choice is performed', () => {
    const prompt = prompts.buildPrompt('episode-content');

    expect(prompt.version).toBe('episode-v8');
    expect(prompt.system).toContain('current active scene conflict must remain unresolved in chapterText');
    expect(prompt.system).toContain('End chapterText immediately BEFORE the decisive action or decision');
    expect(prompt.system).toContain('Do NOT narrate either proposed choice as already completed');
    expect(prompt.system).toContain('Both choices must directly address the SAME current unresolved conflict');
    expect(prompt.system).toContain('exactly choices A and B');
  });

  it('requires prepared branch plans to preserve one unresolved decision point', () => {
    const prompt = prompts.buildPrompt('prepared-next');

    expect(prompt.version).toBe('prepared-next-v5');
    expect(prompt.system).toContain('one unresolved decision point for the END of each prepared episode scene');
    expect(prompt.system).toContain('Both choiceSketches must directly answer that same active unresolved conflict');
    expect(prompt.system).toContain('Do not describe the result of either choice as already completed');
    expect(prompt.system).toContain('exactly choice sketches A and B');
  });

  it("makes Luna's season scaffold hold a concrete unresolved 96-episode arc", () => {
    const framework = prompts.buildPrompt('strategic-season-framework');
    const bible = prompts.buildPrompt('season-bible');
    const outline = prompts.buildPrompt('episode-outline');

    expect(framework.version).toBe('framework-v4');
    expect(framework.system).toContain('sustain exactly 96 short episodes');
    expect(framework.system).toContain('central problem must remain materially unresolved through episode 84');
    expect(framework.system).toContain('concrete, child-visible local goal, obstacle, cost, and irreversible state change');
    expect(bible.version).toBe('bible-v3');
    expect(bible.system).toContain('concrete facts that episode writers can show');
    expect(outline.version).toBe('outline-v3');
    expect(outline.system).toContain('one active local conflict unresolved for the end-of-episode A/B decision');
  });
});
