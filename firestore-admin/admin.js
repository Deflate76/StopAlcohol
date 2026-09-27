import {mountAdmin} from './ui.mjs';

const connection={};
const ui=mountAdmin(document,{
  call:data=>connection.call(data),
  login:()=>connection.login(),logout:()=>connection.logout(),
  refresh:()=>connection.refresh()
});
try {
  const base='https://www.gstatic.com/firebasejs/12.19.0/';
  const [{initializeApp},{getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged},
    {initializeAppCheck,ReCaptchaEnterpriseProvider,getToken}, {getFunctions,httpsCallable}]=await Promise.all([
    import(base+'firebase-app.js'),import(base+'firebase-auth.js'),import(base+'firebase-app-check.js'),import(base+'firebase-functions.js')
  ]);
  const app=initializeApp({apiKey:'AIzaSyBWDwueP3a0atxCqFIgqd96sgXc0EqYbEY',authDomain:'alcoholaway.firebaseapp.com',projectId:'alcoholaway',storageBucket:'alcoholaway.firebasestorage.app',messagingSenderId:'1001199235857',appId:'1:1001199235857:web:362c4aae36b44c7eae12b0'});
  const auth=getAuth(app),appCheck=initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider('6LfI28QtAAAAANzmGSBTvsJWCq4IKNmuxz8CqZ1D'),isTokenAutoRefreshEnabled:true});
  const invoke=httpsCallable(getFunctions(app,'asia-northeast3'),'firestoreAdminApi',{timeout:65000});
  connection.login=()=>signInWithPopup(auth,new GoogleAuthProvider());
  connection.logout=()=>signOut(auth);
  connection.refresh=async()=>{if(auth.currentUser)await auth.currentUser.getIdToken(true);await getToken(appCheck,true);};
  connection.call=async data=>(await invoke(data)).data;
  onAuthStateChanged(auth,user=>ui.setUser(user),error=>ui.initializationError(error));
}catch(error){ui.initializationError(error);}
