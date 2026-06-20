import { _electron as electron } from 'playwright';

export async function launchMedicoApp() {
  const app = await electron.launch({
    args: ['.'], // launches Tauri app from backend/
  });

  const window = await app.firstWindow();
  return { app, window };
}