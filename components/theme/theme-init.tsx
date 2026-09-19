export default function ThemeInit() {
    return (
        <script
            dangerouslySetInnerHTML={{
                __html: `(function(){try{var t=localStorage.getItem("algovault-theme");var dark=t?t==="dark":true;if(dark){document.documentElement.classList.add("dark")}else{document.documentElement.classList.remove("dark")}}catch(e){document.documentElement.classList.add("dark")}})();`,
            }}
        />
    );
}