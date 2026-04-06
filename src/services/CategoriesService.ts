import { db } from './firebase';
import { doc, getDoc, setDoc, arrayUnion } from 'firebase/firestore';
import { CATEGORY_MAP } from '../utils/FileProcessor';

const CATEGORIES_DOC = () => doc(db, 'settings', 'categories');

export async function getCategories(): Promise<string[]> {
  const snap = await getDoc(CATEGORIES_DOC());
  if (!snap.exists() || !snap.data()?.list?.length) {
    const defaults = Object.values(CATEGORY_MAP);
    await setDoc(CATEGORIES_DOC(), { list: defaults });
    return defaults;
  }
  return snap.data().list as string[];
}

export async function addCategory(name: string): Promise<void> {
  await setDoc(CATEGORIES_DOC(), { list: arrayUnion(name) }, { merge: true });
}
