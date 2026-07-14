import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, type Unsubscribe } from "firebase/firestore";
import { db } from "./firebase";

export interface MasterDataItem { id: string; name: string }

function collectionRef(kind: "vendors" | "accounts") { return collection(db, kind); }

export function subscribeMasterData(kind: "vendors" | "accounts", callback: (items: MasterDataItem[]) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collectionRef(kind), orderBy("name")), (snapshot) => {
    callback(snapshot.docs.map((item) => ({ id: item.id, name: String(item.data().name ?? "") })));
  }, onError);
}

export const addMasterData = (kind: "vendors" | "accounts", name: string) => addDoc(collectionRef(kind), { name, createdAt: serverTimestamp() });
export const editMasterData = (kind: "vendors" | "accounts", id: string, name: string) => updateDoc(doc(db, kind, id), { name });
export const deleteMasterData = (kind: "vendors" | "accounts", id: string) => deleteDoc(doc(db, kind, id));
