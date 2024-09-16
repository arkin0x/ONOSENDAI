import logo from '../assets/logo-cropped.png'

function Loading() {
  return (
    <img src={logo} alt="logo" style={{position: "absolute", width: "20svw", bottom: "2svh", right: "2svh", zIndex: 999}}/>
  );
}

export default Loading