import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

describe('Firestore Security Rules — Dirty Dozen Structural Audit', () => {
  it('enforces rules_version 2 and global default-deny catch-all', () => {
    expect(rulesContent).toContain("rules_version = '2';");
    expect(rulesContent).toMatch(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  });

  it('requires verified email on standard writes and platform admin checks', () => {
    expect(rulesContent).toContain('request.auth.token.email_verified == true');
    expect(rulesContent).toContain('function isPlatformAdmin()');
  });

  it('prevents ID poisoning via isValidId regex and max length 128', () => {
    expect(rulesContent).toContain("id.matches('^[a-zA-Z0-9_\\\\-]+$')");
    expect(rulesContent).toContain('id.size() <= 128');
  });

  it('isolates user PII and blocks blanket user listing', () => {
    expect(rulesContent).toMatch(/match \/users\/\{userId\}[\s\S]*?allow list: if false;/);
    expect(rulesContent).toContain("incoming().role == 'driver'");
    expect(rulesContent).toContain('incoming().role == existing().role');
  });

  it('prevents shadow updates via strict hasOnly and affectedKeys().hasOnly()', () => {
    expect(rulesContent).toContain('.keys().hasAll(');
    expect(rulesContent).toContain('.keys().hasOnly(');
    expect(rulesContent).toContain('affectedKeys().hasOnly(');
  });

  it('keeps delivery_events and api_usage strictly append-only (immutable audit trail)', () => {
    expect(rulesContent).toMatch(/match \/delivery_events\/\{eventId\}[\s\S]*?allow update: if false;[\s\S]*?allow delete: if false;/);
    expect(rulesContent).toMatch(/match \/api_usage\/\{usageId\}[\s\S]*?allow update: if false;[\s\S]*?allow delete: if false;/);
  });

  it('locks terminal routes against client mutation', () => {
    expect(rulesContent).toContain("!(existing().status in ['finished', 'cancelled'])");
  });

  it('enforces temporal integrity with server request.time timestamps', () => {
    expect(rulesContent).toContain('incoming().createdAt == request.time');
    expect(rulesContent).toContain('incoming().updatedAt == request.time');
    expect(rulesContent).toContain('incoming().createdAt == existing().createdAt');
  });
});
