import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, FlatList, Image, KeyboardAvoidingView, Linking, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, ImageStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { AppRecord, configured, db, publicApkUrl, Review } from './src/api';

const C = { bg:'#101216', surface:'#1B1E23', raised:'#25292F', ink:'#F4F4F2', muted:'#A3A8AF', accent:'#BCE168', line:'#343941', danger:'#F28F89' };
type OpenedDownload = {appId:string; title:string; version:string; openedAt:string};
type ReleaseEvent = {id:number; app_id:string; title:string; version:string; kind:'new'|'update'; created_at:string};
const HISTORY_KEY='cep-depo-opened-downloads-v1';
const SEEN_KEY='cep-depo-last-seen-release-v1';
const categories = ['Tümü', 'Araçlar', 'Eğlence', 'Oyun', 'Eğitim', 'IPTV', 'Diğer'];
const navIcons = {
  discover: {off: require('./assets/discover-off.png'), on: require('./assets/discover-on.png')},
  account: {off: require('./assets/account-off.png'), on: require('./assets/account-on.png')},
  about: {off: require('./assets/about-off.png'), on: require('./assets/about-on.png')},
  admin: {off: require('./assets/admin-off.png'), on: require('./assets/admin-on.png')},
};
function Button({ title, onPress, outline=false, danger=false, disabled=false }: {title:string; onPress:()=>void; outline?:boolean; danger?:boolean; disabled?:boolean}) {
  return <Pressable disabled={disabled} onPress={onPress} style={[s.button, outline && s.outline, danger && s.danger, disabled && {opacity:.45}]}><Text style={[s.buttonText, outline && {color:C.ink}]}>{title}</Text></Pressable>;
}
function Field({label,value,onChangeText,placeholder,multiline=false,secureTextEntry=false}: {label:string;value:string;onChangeText:(x:string)=>void;placeholder?:string;multiline?:boolean;secureTextEntry?:boolean}) {
  return <View style={{marginBottom:16}}><Text style={s.label}>{label}</Text><TextInput style={[s.input,multiline && {minHeight:104,textAlignVertical:'top'}]} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#7A8088" multiline={multiline} secureTextEntry={secureTextEntry} autoCapitalize="none" /></View>;
}
class AppErrorBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(error:Error){console.error('Cep Depo ekran hatası:',error);}
  render(){
    if(!this.state.failed)return this.props.children;
    return <SafeAreaView style={{flex:1,backgroundColor:C.bg,justifyContent:'center',padding:28}}>
      <Text style={{color:C.ink,fontSize:24,fontWeight:'700',marginBottom:12}}>Bir sorun oluştu.</Text>
      <Text style={{color:C.muted,fontSize:15,lineHeight:23,marginBottom:24}}>Uygulamayı tekrar açmayı deneyebilirsin. Sorun sürerse ekran görüntüsüyle birlikte bize bildir.</Text>
      <Button title="TEKRAR DENE" onPress={()=>this.setState({failed:false})}/>
    </SafeAreaView>;
  }
}
export default function App(){return <AppErrorBoundary><CepDepo/></AppErrorBoundary>;}
function CepDepo() {
  const [session,setSession]=useState<Session|null>(null);
  const [admin,setAdmin]=useState(false);
  const [items,setItems]=useState<AppRecord[]>([]);
  const [selected,setSelected]=useState<AppRecord|null>(null);
  const [tab,setTab]=useState<'catalog'|'account'|'admin'|'about'|'history'|'notifications'>('catalog');
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('Tümü');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [reviews,setReviews]=useState<Review[]>([]);
  const [rating,setRating]=useState(5);
  const [reviewBody,setReviewBody]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [register,setRegister]=useState(true);
  const [authNotice,setAuthNotice]=useState('');
  const [editing,setEditing]=useState<AppRecord|null>(null);
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [appCategory,setAppCategory]=useState('Araçlar');
  const [version,setVersion]=useState('');
  const [iconUrl,setIconUrl]=useState('');
  const [external,setExternal]=useState(false);
  const [accountUrl,setAccountUrl]=useState('');
  const [history,setHistory]=useState<OpenedDownload[]>([]);
  const [events,setEvents]=useState<ReleaseEvent[]>([]);
  const [lastSeen,setLastSeen]=useState(0);
  const [downloadUrl,setDownloadUrl]=useState('');
  const unread=events.filter(event=>event.id>lastSeen).length;
  const notify=(error:unknown)=>Alert.alert('İşlem tamamlanamadı',error instanceof Error?error.message:String(error));
  const reload=useCallback(async()=>{
    if (!configured) return;
    const {data,error}=await db.from('apps').select('*').order('created_at',{ascending:false});
    if(error) setMessage(error.message); else {setItems(data || []);setMessage('');}
  },[]);
  useEffect(()=>{
    if(!configured) return;
    db.auth.getSession().then(({data})=>setSession(data.session)).catch(notify);
    const {data:{subscription}}=db.auth.onAuthStateChange((_event,next)=>setSession(next));
    reload();
    AsyncStorage.multiGet([HISTORY_KEY,SEEN_KEY]).then(rows=>{
      try {const saved=JSON.parse(rows[0][1]||'[]');setHistory(Array.isArray(saved)?saved:[]);} catch {setHistory([]);}
      setLastSeen(Number(rows[1][1]||0)||0);
    }).catch(()=>{setHistory([]);setLastSeen(0);});
    const refreshEvents=async()=>{try{const {data}=await db.from('release_events').select('*').order('id',{ascending:false}).limit(100);if(data)setEvents(data);}catch(error){console.error('Bildirimler yüklenemedi:',error);}};
    refreshEvents();
    const listener=AppState.addEventListener('change',state=>{if(state==='active'){reload();refreshEvents();}});
    return ()=>{subscription.unsubscribe();listener.remove();};
  },[reload]);
  useEffect(()=>{
    if(!session){setAdmin(false);setTab(t=>t==='admin'?'catalog':t);return;}
    db.from('admins').select('user_id').eq('user_id',session.user.id).maybeSingle().then(({data})=>setAdmin(!!data));
  },[session?.user.id]);
  useEffect(()=>{if(!selected){setReviews([]);return;}
    db.from('reviews').select('*').eq('app_id',selected.id).order('created_at',{ascending:false}).then(({data})=>setReviews(data||[]));
  },[selected?.id]);
  const resetForm=()=>{setEditing(null);setTitle('');setDescription('');setAppCategory('Araçlar');setVersion('');setIconUrl('');setExternal(false);setAccountUrl('');setDownloadUrl('');};
  const edit=(item:AppRecord)=>{setEditing(item);setTitle(item.title);setDescription(item.description);setAppCategory(item.category);setVersion(item.version);setIconUrl(item.icon_url||'');setExternal(item.requires_external_account);setAccountUrl(item.account_url||'');setDownloadUrl(item.download_url||'');setTab('admin');setSelected(null);};
  async function save(){
    if(!admin) return;
    if(title.trim().length<2) return Alert.alert('Uygulama adını yaz');
    if(description.trim().length<10) return Alert.alert('Açıklama gerekli','En az 10 karakter yaz.');
    if(!version.trim()) return Alert.alert('Sürüm gerekli','Örneğin 1.0.0 yaz.');
    if(!/^https:\/\/[^\s]+$/i.test(downloadUrl.trim())) return Alert.alert('İndirme bağlantısı gerekli','https:// ile başlayan bir bağlantı yaz.');
    if(external&&!/^https:\/\//i.test(accountUrl.trim())) return Alert.alert('Hesap bağlantısı https:// ile başlamalı');
    setBusy(true);
    try {
      const payload={title:title.trim(),description:description.trim(),category:appCategory,version:version.trim(),icon_url:iconUrl.trim()||null,apk_path:null,download_url:downloadUrl.trim(),requires_external_account:external,account_url:external?accountUrl.trim():null};
      const result=editing?await db.from('apps').update(payload).eq('id',editing.id):await db.from('apps').insert(payload);
      if(result.error) throw result.error;
      if(editing?.apk_path) await db.storage.from('apks').remove([editing.apk_path]);
      resetForm();await reload();
      const {data}=await db.from('release_events').select('*').order('id',{ascending:false}).limit(100);if(data)setEvents(data);
      Alert.alert('Kaydedildi',editing?'Uygulama güncellendi.':'Uygulama yayınlandı.');
    } catch(e){notify(e);}finally{setBusy(false);}
  }
  function remove(item:AppRecord){
    Alert.alert('Uygulamayı kaldır',`${item.title} mağazadan kaldırılacak.`,[{text:'Vazgeç',style:'cancel'},{text:'Kaldır',style:'destructive',onPress:async()=>{
      const {error}=await db.from('apps').delete().eq('id',item.id);if(error)return notify(error);
      if(item.apk_path) await db.storage.from('apks').remove([item.apk_path]);setSelected(null);resetForm();reload();
    }}]);
  }
  async function authenticate(){
    if(!email.trim()||!password) return Alert.alert('Eksik bilgi','E-posta ve şifre gir.');
    if(register && password.length<6) return Alert.alert('Şifre kısa','En az 6 karakterli bir şifre seç.');
    setBusy(true);setAuthNotice('');
    try {
      const {data,error}=register
        ? await db.auth.signUp({email:email.trim(),password})
        : await db.auth.signInWithPassword({email:email.trim(),password});
      if(error){
        const code=error.code || '';
        const text=code==='invalid_credentials'?'E-posta veya şifre yanlış. Hesabın yoksa yukarıdan “Hesap oluştur”u seç.'
          :code==='email_not_confirmed'?'Giriş yapmadan önce e-postana gelen doğrulama bağlantısını aç.'
          :code==='user_already_exists'?'Bu e-postayla hesap var. “Giriş yap”ı seç.'
          :code==='weak_password'?'Daha güçlü bir şifre seç.'
          :error.message;
        Alert.alert('İşlem tamamlanamadı',text);return;
      }
      setPassword('');
      if(register && !data.session){setAuthNotice('Kayıt alındı. E-postana gelen doğrulama bağlantısını aç, sonra “Giriş yap”ı seç. Gelen kutusu ve spam klasörünü kontrol et.');setRegister(false);}
      else {setTab('catalog');setAuthNotice('');}
    } catch(e){notify(e);}finally{setBusy(false);}
  }
  async function sendReview(){
    if(!session)return setTab('account');
    if(reviewBody.trim().length<2||!selected)return Alert.alert('Yorum en az 2 karakter olmalı');
    const {error}=await db.from('reviews').upsert({app_id:selected.id,author_id:session.user.id,body:reviewBody.trim(),rating},{onConflict:'app_id,author_id'});
    if(error)return notify(error);
    setReviewBody('');const {data}=await db.from('reviews').select('*').eq('app_id',selected.id).order('created_at',{ascending:false});setReviews(data||[]);
  }
  async function deleteReview(r:Review){const {error}=await db.from('reviews').delete().eq('id',r.id);if(error)return notify(error);setReviews(list=>list.filter(x=>x.id!==r.id));}
  async function download(item:AppRecord){
    const url=item.download_url || (item.apk_path?publicApkUrl(item.apk_path):null);
    if(!url) return Alert.alert('İndirme bağlantısı bulunamadı');
    try{await Linking.openURL(url);
      const next=[{appId:item.id,title:item.title,version:item.version,openedAt:new Date().toISOString()},...history.filter(x=>x.appId!==item.id)].slice(0,100);
      setHistory(next);await AsyncStorage.setItem(HISTORY_KEY,JSON.stringify(next));
    }catch(e){notify(e);}
  }
  async function openNotifications(){
    setSelected(null);setTab('notifications');
    const newest=events[0]?.id||lastSeen;setLastSeen(newest);await AsyncStorage.setItem(SEEN_KEY,String(newest));
  }
  const visible=items.filter(item=>(category==='Tümü'||item.category===category)&&`${item.title} ${item.description}`.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr')));
  if(!configured)return <SafeAreaView style={s.root}><View style={s.empty}><Text style={s.wordmark}>cep depo.</Text><Text style={s.sub}>Bağlantı ayarı gerekiyor. README dosyasındaki Supabase kurulumunu tamamla.</Text></View></SafeAreaView>;
  return <SafeAreaView style={s.root}><StatusBar barStyle="light-content" backgroundColor={C.bg}/><View style={s.header}><Text style={s.wordmark}>cep depo<Text style={{color:C.accent}}>.</Text></Text><View style={s.headerActions}><Pressable onPress={()=>{setSelected(null);setTab('history');}}><Text style={s.headerAction}>Geçmiş</Text></Pressable><Pressable onPress={openNotifications}><Text style={s.headerAction}>Bildirimler{unread>0?` · ${unread}`:''}</Text></Pressable></View></View>
    {selected?<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      <Pressable onPress={()=>setSelected(null)}><Text style={s.back}>‹  Uygulamalar</Text></Pressable>
      <View style={s.detailHead}>{selected.icon_url?<Image source={{uri:selected.icon_url}} style={s.largeIcon as ImageStyle}/>:<View style={[s.largeIcon,s.iconFallback]}><Text style={s.fallbackText}>{selected.title[0]}</Text></View>}<View style={{flex:1}}><Text style={s.title}>{selected.title}</Text><Text style={s.sub}>{selected.category}  ·  v{selected.version}</Text></View></View>
      {selected.requires_external_account&&<View style={s.notice}><Text style={s.noticeTitle}>Hesap gerekiyor</Text><Text style={s.sub}>Bu uygulamaya giriş için uygulamanın yöneticisinden hesap almalısın.</Text>{selected.account_url&&<Pressable onPress={()=>Linking.openURL(selected.account_url!)}><Text style={s.link}>Hesap iste / Gruba git  ↗</Text></Pressable>}</View>}
      <Button title={history.some(x=>x.appId===selected.id&&x.version!==selected.version)?"GÜNCELLE  ↗":"APK İNDİR  ↗"} onPress={()=>download(selected)}/><Text style={[s.sub,{marginTop:8}]}>İndirme, yayıncının kullandığı serviste devam eder.</Text>
      <Text style={s.sectionTitle}>Hakkında</Text><Text style={s.body}>{selected.description}</Text>
      {admin&&<View style={s.row}><Button title="Düzenle / Yeni sürüm" outline onPress={()=>edit(selected)}/><Button title="Kaldır" danger onPress={()=>remove(selected)}/></View>}
      <Text style={s.sectionTitle}>Yorumlar</Text>
      {session?<><View style={s.stars}>{[1,2,3,4,5].map(n=><Pressable key={n} onPress={()=>setRating(n)}><Text style={[s.star,{color:n<=rating?C.accent:C.muted}]}>★</Text></Pressable>)}</View><Field label="Yorumun" value={reviewBody} onChangeText={setReviewBody} placeholder="Uygulama hakkında ne düşünüyorsun?" multiline/><Button title="Yorumu gönder" onPress={sendReview}/></>:<Button title="Yorum yapmak için giriş yap" outline onPress={()=>{setSelected(null);setTab('account');}}/>}
      {reviews.length===0&&<Text style={[s.sub,{marginTop:20}]}>Henüz yorum yok.</Text>}
      {reviews.map(r=><View key={r.id} style={s.review}><Text style={s.reviewTop}>{'★'.repeat(r.rating)}  <Text style={s.sub}>{new Date(r.created_at).toLocaleDateString('tr-TR')}</Text></Text><Text style={s.body}>{r.body}</Text>{(admin||r.author_id===session?.user.id)&&<Pressable onPress={()=>deleteReview(r)}><Text style={s.smallDanger}>Yorumu sil</Text></Pressable>}</View>)}
    </ScrollView>:tab==='catalog'?<View style={{flex:1}}><View style={{paddingHorizontal:22,paddingTop:12}}><Text style={s.hero}>Uygulamanı bul.</Text><Text style={s.sub}>Seç, incele, indir.</Text><TextInput style={[s.input,{marginTop:24}]} value={query} onChangeText={setQuery} placeholder="Uygulama ara" placeholderTextColor="#7A8088"/></View><View style={{height:62}}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal:22,alignItems:'center',gap:8}}>{categories.map(cat=><Pressable key={cat} onPress={()=>setCategory(cat)} style={[s.chip,category===cat&&s.chipActive]}><Text style={[s.chipText,category===cat&&{color:C.bg}]}>{cat}</Text></Pressable>)}</ScrollView></View><FlatList data={visible} keyExtractor={x=>x.id} contentContainerStyle={{paddingHorizontal:22,paddingBottom:30}} refreshing={busy} onRefresh={reload} ListEmptyComponent={<View style={s.emptyCard}><Text style={s.emptyTitle}>{message?'Uygulamalar yüklenemedi.':items.length===0?'Mağaza henüz boş.':'Sonuç bulunamadı.'}</Text><Text style={s.sub}>{message|| (items.length===0?'İlk uygulama yayınlandığında burada görünecek.':'Başka bir kelime veya kategori dene.')}</Text>{admin&&items.length===0&&<Pressable onPress={()=>setTab('admin')}><Text style={s.link}>İlk uygulamayı yayınla  →</Text></Pressable>}</View>} renderItem={({item})=><Pressable style={s.card} onPress={()=>setSelected(item)}>{item.icon_url?<Image source={{uri:item.icon_url}} style={s.icon as ImageStyle}/>:<View style={[s.icon,s.iconFallback]}><Text style={s.fallbackText}>{item.title[0]}</Text></View>}<View style={{flex:1}}><Text style={s.cardTitle} numberOfLines={1}>{item.title}</Text><Text style={s.sub}>{item.category}  ·  v{item.version}</Text>{item.requires_external_account&&<Text style={s.badge}>Hesap gerekli</Text>}{history.some(x=>x.appId===item.id&&x.version!==item.version)&&<Text style={s.badge}>Yeni sürüm var</Text>}</View><Text style={s.arrow}>↗</Text></Pressable>}/></View>:tab==='account'?<ScrollView contentContainerStyle={s.content}><Text style={s.hero}>Hesabın.</Text>{session?<><Text style={[s.sub,{marginBottom:28}]}>{session.user.email}</Text>{admin&&<Text style={s.badge}>YÖNETİCİ</Text>}<Button title="Çıkış yap" outline onPress={()=>db.auth.signOut()}/></>:<><Text style={[s.sub,{marginBottom:24}]}>Uygulama indirmek için hesap gerekmez. Yorum yapmak için giriş yap.</Text><View style={s.authTabs}><Pressable style={[s.authTab,register&&s.authTabActive]} onPress={()=>{setRegister(true);setAuthNotice('');setPassword('');}}><Text style={[s.authTabText,register&&s.authTabTextActive]}>Hesap oluştur</Text></Pressable><Pressable style={[s.authTab,!register&&s.authTabActive]} onPress={()=>{setRegister(false);setAuthNotice('');setPassword('');}}><Text style={[s.authTabText,!register&&s.authTabTextActive]}>Giriş yap</Text></Pressable></View>{authNotice? <View style={s.notice}><Text style={s.noticeTitle}>E-postanı doğrula</Text><Text style={s.body}>{authNotice}</Text></View>:null}<Field label="E-posta" value={email} onChangeText={setEmail} placeholder="ornek@eposta.com"/><Field label="Şifre" value={password} onChangeText={setPassword} secureTextEntry/><Button title={busy?'Bekle…':register?'Hesabımı oluştur':'Giriş yap'} disabled={busy} onPress={authenticate}/><Text style={[s.sub,{marginTop:15}]}>{register?'Kayıttan sonra e-postanı doğrulaman gerekebilir.':'Bu mağaza için oluşturduğun hesabın şifresini kullan.'}</Text></>}</ScrollView>:tab==='about'?<ScrollView contentContainerStyle={s.content}><Text style={s.hero}>Cep Depo.</Text><Text style={[s.sub,{marginTop:8}]}>Android uygulama mağazası</Text><Text style={s.sectionTitle}>Uygulama hakkında</Text><Text style={s.body}>Cep Depo, uygulamaları inceleyip APK dosyalarını indirebileceğin bir katalogdur. Bazı uygulamaları kullanmak için uygulamanın yöneticisinden ayrıca hesap alman gerekebilir. Bu bilgi indirme sayfasında gösterilir.</Text><View style={s.aboutRule}/><Text style={s.label}>SÜRÜM</Text><Text style={s.body}>0.1.0</Text><View style={s.aboutRule}/><Text style={s.label}>İNDİRME VE HESAP</Text><Text style={s.body}>Uygulama indirmek için Cep Depo hesabı gerekmez. Yorum yazmak için hesap oluşturabilirsin.</Text></ScrollView>:tab==='history'?<ScrollView contentContainerStyle={s.content}><Text style={s.hero}>Geçmiş.</Text><Text style={[s.sub,{marginTop:8,marginBottom:25}]}>Açtığın indirme bağlantıları bu cihazda tutulur. İndirme veya kurulum tamamlandığını göstermez.</Text>{history.length===0&&<Text style={s.sub}>Henüz bağlantı açmadın.</Text>}{history.map(entry=>{const current=items.find(x=>x.id===entry.appId);return <Pressable key={entry.appId} style={s.card} onPress={()=>{if(current){setSelected(current);setTab('catalog');}else Alert.alert('Bu uygulama mağazadan kaldırılmış');}}><View style={{flex:1}}><Text style={s.cardTitle}>{entry.title}</Text><Text style={s.sub}>v{entry.version} · {new Date(entry.openedAt).toLocaleDateString('tr-TR')}</Text>{current&&current.version!==entry.version&&<Text style={s.badge}>Yeni sürüm: v{current.version}</Text>}</View><Text style={s.arrow}>›</Text></Pressable>})}</ScrollView>:tab==='notifications'?<ScrollView contentContainerStyle={s.content}><Text style={s.hero}>Bildirimler.</Text><Text style={[s.sub,{marginTop:8,marginBottom:25}]}>Yeni yayınlar ve sürümler burada görünür. Liste uygulama açıldığında yenilenir.</Text>{events.length===0&&<Text style={s.sub}>Henüz duyuru yok.</Text>}{events.map(event=><Pressable key={event.id} style={s.card} onPress={()=>{const item=items.find(x=>x.id===event.app_id);if(item){setSelected(item);setTab('catalog');}}}><View style={{flex:1}}><Text style={s.cardTitle}>{event.title}</Text><Text style={s.sub}>{event.kind==='new'?'Yeni yayın':'Yeni sürüm'} · v{event.version} · {new Date(event.created_at).toLocaleDateString('tr-TR')}</Text></View><Text style={s.arrow}>›</Text></Pressable>)}</ScrollView>:admin?<KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={s.content}><Text style={s.hero}>{editing?'Uygulamayı düzenle.':'Uygulama yayınla.'}</Text><Text style={[s.sub,{marginBottom:28}]}>{editing?'Yeni sürüm ve indirme bağlantısını düzenle.':'İndirme bağlantısını yayınla.'}</Text>
      <Field label="Uygulama adı" value={title} onChangeText={setTitle} placeholder="Örn. Not Defteri"/><Field label="Hakkında" value={description} onChangeText={setDescription} multiline placeholder="Ne işe yarıyor?"/><Text style={s.label}>Kategori</Text><View style={s.wrap}>{categories.slice(1).map(cat=><Pressable key={cat} onPress={()=>setAppCategory(cat)} style={[s.chip,appCategory===cat&&s.chipActive]}><Text style={[s.chipText,appCategory===cat&&{color:C.bg}]}>{cat}</Text></Pressable>)}</View><Field label="Sürüm" value={version} onChangeText={setVersion} placeholder="1.0.0"/><Field label="APK indirme bağlantısı" value={downloadUrl} onChangeText={setDownloadUrl} placeholder="https://..."/><Text style={[s.sub,{marginBottom:16,marginTop:-8}]}>TeraBox veya başka servisteki paylaşım adresini buraya yapıştır.</Text><Field label="İkon görselinin HTTPS bağlantısı (isteğe bağlı)" value={iconUrl} onChangeText={setIconUrl} placeholder="https://..."/><Pressable onPress={()=>setExternal(!external)} style={s.toggle}><Text style={s.body}>{external?'☑':'□'}  Kullanmak için harici hesap gerekiyor</Text></Pressable>{external&&<Field label="Hesap isteme / grup bağlantısı" value={accountUrl} onChangeText={setAccountUrl} placeholder="https://..."/>}<View style={{height:14}}/><Button title={busy?'Kaydediliyor…':editing?'Değişiklikleri kaydet':'Yayınla'} disabled={busy} onPress={save}/>{editing&&<Pressable onPress={resetForm}><Text style={[s.link,{marginTop:20}]}>Düzenlemeyi iptal et</Text></Pressable>}</ScrollView></KeyboardAvoidingView>:<View style={s.empty}><Text style={s.sub}>Bu alan yalnızca yöneticiye açıktır.</Text></View>}
    {!selected&&<View style={s.nav}><Pressable accessibilityRole="tab" accessibilityLabel="Keşfet" style={s.navItem} onPress={()=>setTab('catalog')}><Image source={navIcons.discover[tab==='catalog'?'on':'off']} style={s.navIcon}/><Text style={[s.navText,tab==='catalog'&&s.navActive]}>Keşfet</Text></Pressable><Pressable accessibilityRole="tab" accessibilityLabel="Hesap" style={s.navItem} onPress={()=>setTab('account')}><Image source={navIcons.account[tab==='account'?'on':'off']} style={s.navIcon}/><Text style={[s.navText,tab==='account'&&s.navActive]}>Hesap</Text></Pressable><Pressable accessibilityRole="tab" accessibilityLabel="Hakkında" style={s.navItem} onPress={()=>setTab('about')}><Image source={navIcons.about[tab==='about'?'on':'off']} style={s.navIcon}/><Text style={[s.navText,tab==='about'&&s.navActive]}>Hakkında</Text></Pressable>{admin&&<Pressable accessibilityRole="tab" accessibilityLabel="Yönetim" style={s.navItem} onPress={()=>setTab('admin')}><Image source={navIcons.admin[tab==='admin'?'on':'off']} style={s.navIcon}/><Text style={[s.navText,tab==='admin'&&s.navActive]}>Yönetim</Text></Pressable>}</View>}
  </SafeAreaView>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:C.bg,paddingTop:Platform.OS==='android'?StatusBar.currentHeight:0},header:{height:70,paddingHorizontal:22,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:C.line},wordmark:{fontSize:25,fontWeight:'800',letterSpacing:-1.4,color:C.ink},headerRight:{fontSize:10,fontWeight:'700',letterSpacing:2.2,color:C.muted},headerActions:{flexDirection:'row',gap:15,alignItems:'center'},headerAction:{color:C.muted,fontSize:12,fontWeight:'700'},content:{padding:22,paddingBottom:44},hero:{fontSize:34,fontWeight:'800',letterSpacing:-1.4,color:C.ink,marginBottom:3},title:{fontSize:25,fontWeight:'700',letterSpacing:-.7,color:C.ink},sub:{color:C.muted,fontSize:13,lineHeight:20},body:{fontSize:15,color:C.ink,lineHeight:23},input:{backgroundColor:C.surface,color:C.ink,borderColor:C.line,borderWidth:1,borderRadius:13,paddingHorizontal:15,paddingVertical:15,fontSize:15},label:{color:C.muted,fontSize:12,fontWeight:'700',marginBottom:8,letterSpacing:.3},button:{backgroundColor:C.accent,paddingVertical:16,paddingHorizontal:19,borderRadius:13,alignItems:'center',justifyContent:'center',minHeight:52},buttonText:{color:C.bg,fontSize:14,fontWeight:'800'},outline:{backgroundColor:C.surface,borderWidth:1,borderColor:C.line},danger:{backgroundColor:C.danger},chip:{borderWidth:1,borderColor:C.line,borderRadius:100,paddingHorizontal:16,paddingVertical:10,backgroundColor:C.surface},chipActive:{backgroundColor:C.accent,borderColor:C.accent},chipText:{fontSize:12,fontWeight:'700',color:C.muted},card:{backgroundColor:C.surface,borderWidth:1,borderColor:C.line,borderRadius:18,padding:15,marginBottom:11,flexDirection:'row',alignItems:'center',gap:14},icon:{width:54,height:54,borderRadius:13},largeIcon:{width:75,height:75,borderRadius:19},iconFallback:{backgroundColor:'#3D4933',alignItems:'center',justifyContent:'center'},fallbackText:{color:C.accent,fontSize:29,fontWeight:'800'},cardTitle:{color:C.ink,fontSize:16,fontWeight:'700',marginBottom:3},arrow:{color:C.accent,fontSize:21},badge:{color:C.accent,fontSize:11,fontWeight:'700',marginTop:6},back:{color:C.muted,fontSize:14,marginBottom:24},detailHead:{flexDirection:'row',alignItems:'center',gap:16,marginBottom:27},notice:{backgroundColor:'#262D22',borderRadius:15,padding:18,marginBottom:20,borderColor:'#3C4A34',borderWidth:1},noticeTitle:{color:C.accent,fontSize:15,fontWeight:'800',marginBottom:7},link:{color:C.accent,fontSize:14,fontWeight:'700',marginTop:12},sectionTitle:{color:C.ink,fontSize:21,fontWeight:'700',marginTop:32,marginBottom:15},row:{flexDirection:'row',gap:8,marginTop:20},review:{borderTopWidth:1,borderTopColor:C.line,paddingVertical:16},reviewTop:{color:C.accent,marginBottom:8},smallDanger:{color:C.danger,fontSize:12,marginTop:8},stars:{flexDirection:'row',gap:9,marginBottom:14},star:{fontSize:28},nav:{height:65,borderTopWidth:1,borderTopColor:C.line,flexDirection:'row',backgroundColor:C.bg},navItem:{flex:1,alignItems:'center',justifyContent:'center',gap:3},navIcon:{width:22,height:22},aboutRule:{height:1,backgroundColor:C.line,marginVertical:22},navText:{color:C.muted,fontSize:13,fontWeight:'600'},navActive:{color:C.accent},empty:{flex:1,justifyContent:'center',padding:30},emptyCard:{marginTop:24,backgroundColor:C.surface,borderWidth:1,borderColor:C.line,borderRadius:18,padding:22},emptyTitle:{color:C.ink,fontSize:17,fontWeight:'700',marginBottom:7},authTabs:{flexDirection:'row',gap:8,marginBottom:23},authTab:{flex:1,alignItems:'center',paddingVertical:14,backgroundColor:C.surface,borderWidth:1,borderColor:C.line,borderRadius:12},authTabActive:{backgroundColor:C.accent,borderColor:C.accent},authTabText:{color:C.muted,fontWeight:'700',fontSize:13},authTabTextActive:{color:C.bg},toggle:{paddingVertical:13,marginBottom:14},wrap:{flexDirection:'row',gap:8,flexWrap:'wrap',marginBottom:20}});
