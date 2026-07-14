import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "./firebase";

export const ADMIN_UID = "WWJdXATalpg8ekf1qyhulua7gTi2";
export const isAdmin = () => auth.currentUser?.uid === ADMIN_UID;
export const signInAdmin = (email: string, password: string) => signInWithEmailAndPassword(auth, email, password);
export const signOutAdmin = () => signOut(auth);
