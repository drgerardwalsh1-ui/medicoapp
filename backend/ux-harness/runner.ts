import { launchMedicoApp } from './playwright/launch';
import { runPTSDIntake } from './flows/intake/ptsd.flow';
import { assertPTSDTransition } from './assertions/clinicalAssertions';

async function run() {
  const { app, window } = await launchMedicoApp();

  try {
    await runPTSDIntake(window);
    await assertPTSDTransition(window);

    console.log('✅ PTSD clinical flow passed');
  } catch (e) {
    console.error('❌ Clinical flow failed', e);
  } finally {
    await app.close();
  }
}

run();