export default function ThemeInit() {
    return (
        <script
            dangerouslySetInnerHTML={{
                __html: `(function(){try{var t=localStorage.getItem("algovault-theme");var light=t==="light";document.documentElement.classList.toggle("light",light);document.documentElement.classList.toggle("dark",!light)}catch(e){document.documentElement.classList.add("dark")}})();`,
            }}
        />
    );
}